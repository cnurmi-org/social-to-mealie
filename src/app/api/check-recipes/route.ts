import { getAllRecipes } from "@//lib/mealie";
import { env } from "@//lib/constants";
import type { MealieRecipeFull, RecipeCheckResult } from "@//lib/types";

async function hasImage(recipe: MealieRecipeFull): Promise<boolean> {
    if (!recipe.image) return false;
    try {
        const res = await fetch(
            `${env.MEALIE_URL}/api/media/recipes/${recipe.id}/images/original.webp`,
            {
                method: "HEAD",
                headers: { Authorization: `Bearer ${env.MEALIE_API_KEY}` },
            }
        );
        return res.ok;
    } catch {
        return false;
    }
}

export async function GET() {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                const recipes = await getAllRecipes();
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "total", count: recipes.length })}\n\n`)
                );

                for (const recipe of recipes) {
                    const imageOk = await hasImage(recipe);
                    const result: RecipeCheckResult = {
                        id: recipe.id,
                        slug: recipe.slug,
                        name: recipe.name,
                        mealieUrl: `${env.MEALIE_URL}/g/${env.MEALIE_GROUP_NAME}/r/${recipe.slug}`,
                        editUrl: `${env.MEALIE_URL}/g/${env.MEALIE_GROUP_NAME}/r/${recipe.slug}/edit`,
                        checks: {
                            hasIngredients: {
                                pass: recipe.recipeIngredient.length > 0,
                                fixable: true,
                            },
                            hasInstructions: {
                                pass: recipe.recipeInstructions.length > 0,
                                fixable: true,
                            },
                            hasImage: {
                                pass: imageOk,
                                fixable: false,
                            },
                            hasSourceUrl: {
                                pass: !!recipe.orgURL,
                                fixable: false,
                            },
                        },
                        fixed: null,
                    };

                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "result", recipe: result })}\n\n`)
                    );
                }

                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
                );
            } catch (err: any) {
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`)
                );
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
