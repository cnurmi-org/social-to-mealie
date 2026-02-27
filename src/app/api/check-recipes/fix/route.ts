import { getFullRecipe, updateRecipe } from "@//lib/mealie";
import { generateMissingContent } from "@//lib/ai";

export async function POST(req: Request) {
    try {
        const { slug } = await req.json();
        if (!slug) {
            return new Response(JSON.stringify({ error: "slug is required" }), { status: 400 });
        }

        const recipe = await getFullRecipe(slug);
        const missing: ("ingredients" | "instructions")[] = [];

        if (recipe.recipeIngredient.length === 0) missing.push("ingredients");
        if (recipe.recipeInstructions.length === 0) missing.push("instructions");

        if (missing.length === 0) {
            return new Response(JSON.stringify({ fixed: [] }), { status: 200 });
        }

        const patch = await generateMissingContent(recipe, missing);
        await updateRecipe(slug, patch);

        return new Response(JSON.stringify({ fixed: missing }), { status: 200 });
    } catch (err: any) {
        console.error("Error in fix route:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
