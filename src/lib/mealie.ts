import { env } from "@//lib/constants";
import type { recipeResult, MealieRecipeFull } from "./types";

export async function postRecipe(recipeData: any) {
    try {
        const payloadData =
            typeof recipeData === "string"
                ? recipeData
                : JSON.stringify(recipeData);

        const res = await fetch(
            `${env.MEALIE_URL}/api/recipes/create/html-or-json`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.MEALIE_API_KEY}`,
                },
                body: JSON.stringify({
                    includeTags: true,
                    data: payloadData,
                }),
                signal: AbortSignal.timeout(120000),
            }
        );

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`${res.status} ${res.statusText} - ${errorText}`);
            throw new Error("Failed to create recipe");
        }
        const body = await res.json();
        console.log("Recipe response:", body);
        return body;
    } catch (error: any) {
        if (error.name === "AbortError") {
            console.error(
                "Timeout creating mealie recipe. Report this issue on Mealie GitHub."
            );
            throw new Error(
                `Timeout creating mealie recipe. Report this issue on Mealie GitHub. Input URL: ${env.MEALIE_URL}`
            );
        }
        console.error("Error in postRecipe:", error);
        throw new Error(error.message);
    }
}

export async function getRecipe(recipeSlug: string): Promise<recipeResult> {
    const res = await fetch(`${env.MEALIE_URL}/api/recipes/${recipeSlug}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MEALIE_API_KEY}`,
        },
    });

    const body = await res.json();
    if (!res.ok) throw new Error("Failed to get recipe");

    return {
        name: body.name,
        description: body.description,
        imageUrl: `${env.MEALIE_URL}/api/media/recipes/${body.id}/images/original.webp`,
        url: `${env.MEALIE_URL}/g/${env.MEALIE_GROUP_NAME}/r/${recipeSlug}`,
    };
}

export async function getFullRecipe(slug: string): Promise<MealieRecipeFull> {
    const res = await fetch(`${env.MEALIE_URL}/api/recipes/${slug}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MEALIE_API_KEY}`,
        },
    });

    if (!res.ok) throw new Error(`Failed to get recipe: ${slug}`);
    const body = await res.json();

    return {
        id: body.id,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        orgURL: body.orgURL ?? null,
        image: body.image ?? null,
        recipeIngredient: body.recipeIngredient ?? [],
        recipeInstructions: body.recipeInstructions ?? [],
    };
}

export async function getAllRecipes(): Promise<MealieRecipeFull[]> {
    const results: MealieRecipeFull[] = [];
    let page = 1;
    const perPage = 50;

    while (true) {
        const res = await fetch(
            `${env.MEALIE_URL}/api/recipes?perPage=${perPage}&page=${page}`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.MEALIE_API_KEY}`,
                },
            }
        );

        if (!res.ok) throw new Error("Failed to list recipes");
        const body = await res.json();
        const items: any[] = body.items ?? [];
        if (items.length === 0) break;

        const full = await Promise.all(items.map((r: any) => getFullRecipe(r.slug)));
        results.push(...full);

        if (items.length < perPage) break;
        page++;
    }

    return results;
}

export async function updateRecipe(slug: string, patch: Partial<MealieRecipeFull>): Promise<void> {
    const res = await fetch(`${env.MEALIE_URL}/api/recipes/${slug}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MEALIE_API_KEY}`,
        },
        body: JSON.stringify(patch),
    });

    if (!res.ok) {
        const errorText = await res.text();
        console.error(`Failed to update recipe ${slug}: ${res.status} ${errorText}`);
        throw new Error(`Failed to update recipe: ${slug}`);
    }
}
