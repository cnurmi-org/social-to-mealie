'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { RecipeCheckResult } from '@/lib/types';
import { CircleCheck, CircleX } from 'lucide-react';
import { useState } from 'react';

function CheckIcon({ pass }: { pass: boolean }) {
  return pass ? <CircleCheck className='inline h-4 w-4 text-green-600' /> : <CircleX className='inline h-4 w-4 text-red-500' />;
}

export default function CheckPage() {
  const [results, setResults] = useState<RecipeCheckResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [fixing, setFixing] = useState<Record<string, boolean>>({});

  async function runChecks() {
    setResults([]);
    setTotal(null);
    setDone(false);
    setLoading(true);

    const response = await fetch('/api/check-recipes');
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      const chunk = decoder.decode(value);
      chunk.split('\n\n').forEach((event) => {
        if (!event.startsWith('data: ')) return;
        try {
          const data = JSON.parse(event.replace('data: ', ''));
          if (data.type === 'total') setTotal(data.count);
          if (data.type === 'result') setResults((prev) => [...prev, data.recipe]);
          if (data.type === 'done') { setDone(true); setLoading(false); }
          if (data.type === 'error') { console.error(data.error); setLoading(false); }
        } catch { /* ignore parse errors */ }
      });
    }

    setLoading(false);
  }

  async function fixRecipe(slug: string) {
    setFixing((prev) => ({ ...prev, [slug]: true }));
    try {
      const res = await fetch('/api/check-recipes/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (data.fixed && data.fixed.length > 0) {
        setResults((prev) =>
          prev.map((r) => {
            if (r.slug !== slug) return r;
            const updated = { ...r, fixed: data.fixed };
            if (data.fixed.includes('ingredients')) updated.checks = { ...updated.checks, hasIngredients: { pass: true, fixable: true } };
            if (data.fixed.includes('instructions')) updated.checks = { ...updated.checks, hasInstructions: { pass: true, fixable: true } };
            return updated;
          })
        );
      }
    } catch (err) {
      console.error('Fix failed:', err);
    } finally {
      setFixing((prev) => ({ ...prev, [slug]: false }));
    }
  }

  const issueCount = results.filter(
    (r) => !r.checks.hasIngredients.pass || !r.checks.hasInstructions.pass || !r.checks.hasImage.pass || !r.checks.hasSourceUrl.pass
  ).length;

  return (
    <div className='p-8 max-w-6xl mx-auto'>
      <h1 className='text-2xl font-bold mb-2'>Recipe Sanity Check</h1>
      <p className='text-muted-foreground mb-6'>
        Checks all Mealie recipes for missing ingredients, instructions, image, and source URL. Auto-fix is available for missing ingredients and instructions.
      </p>

      <div className='flex items-center gap-4 mb-6'>
        <Button onClick={runChecks} disabled={loading}>
          {loading ? 'Checking...' : 'Run Checks'}
        </Button>
        {loading && total !== null && (
          <span className='text-sm text-muted-foreground flex items-center gap-2'>
            <Spinner size='small' />
            Checked {results.length} of {total} — {issueCount} issue{issueCount !== 1 ? 's' : ''} found
          </span>
        )}
        {done && (
          <span className='text-sm text-muted-foreground'>
            Done — {results.length} recipes checked, {issueCount} issue{issueCount !== 1 ? 's' : ''} found
          </span>
        )}
      </div>

      {results.length > 0 && (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm border-collapse'>
            <thead>
              <tr className='border-b text-left'>
                <th className='py-2 pr-4 font-semibold'>Recipe</th>
                <th className='py-2 pr-4 font-semibold text-center'>Ingredients</th>
                <th className='py-2 pr-4 font-semibold text-center'>Instructions</th>
                <th className='py-2 pr-4 font-semibold text-center'>Image</th>
                <th className='py-2 pr-4 font-semibold text-center'>Source URL</th>
                <th className='py-2 font-semibold'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((recipe) => {
                const canFix =
                  (!recipe.checks.hasIngredients.pass && recipe.checks.hasIngredients.fixable) ||
                  (!recipe.checks.hasInstructions.pass && recipe.checks.hasInstructions.fixable);
                const allGood =
                  recipe.checks.hasIngredients.pass &&
                  recipe.checks.hasInstructions.pass &&
                  recipe.checks.hasImage.pass &&
                  recipe.checks.hasSourceUrl.pass;

                return (
                  <tr key={recipe.id} className={`border-b ${allGood ? '' : 'bg-red-50/40'}`}>
                    <td className='py-2 pr-4'>
                      <a href={recipe.mealieUrl} target='_blank' rel='noreferrer' className='font-medium hover:underline'>
                        {recipe.name}
                      </a>
                      {recipe.fixed && recipe.fixed.length > 0 && (
                        <span className='ml-2'>
                          <Badge variant='outline' className='text-green-700 border-green-400'>Fixed: {recipe.fixed.join(', ')}</Badge>
                        </span>
                      )}
                    </td>
                    <td className='py-2 pr-4 text-center'><CheckIcon pass={recipe.checks.hasIngredients.pass} /></td>
                    <td className='py-2 pr-4 text-center'><CheckIcon pass={recipe.checks.hasInstructions.pass} /></td>
                    <td className='py-2 pr-4 text-center'><CheckIcon pass={recipe.checks.hasImage.pass} /></td>
                    <td className='py-2 pr-4 text-center'><CheckIcon pass={recipe.checks.hasSourceUrl.pass} /></td>
                    <td className='py-2'>
                      {canFix && !recipe.fixed && (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={fixing[recipe.slug]}
                          onClick={() => fixRecipe(recipe.slug)}
                        >
                          {fixing[recipe.slug] ? <Spinner size='small' /> : 'Fix'}
                        </Button>
                      )}
                      {recipe.fixed && recipe.fixed.length > 0 && (
                        <a href={recipe.editUrl} target='_blank' rel='noreferrer' className='text-xs text-muted-foreground hover:underline'>
                          Review in Mealie
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
