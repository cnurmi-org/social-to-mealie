import { getRecipe, getFullRecipe, postRecipe } from "@//lib/mealie";
import type { progressType, socialMediaResult } from "@//lib/types";
import { generateRecipeFromAI, getTranscription, checkRecipeCoherence } from "@/lib/ai";
import { env } from "@/lib/constants";
import { downloadMediaWithYtDlp } from "@/lib/yt-dlp";

interface RequestBody {
    url: string;
    tags: string[];
}
async function handleRequest(
    url: string,
    tags: string[],
    isSse: boolean,
    controller?: ReadableStreamDefaultController
) {
    const encoder = new TextEncoder();
    let socialMediaResult: socialMediaResult;

    const progress: progressType = {
        videoDownloaded: null,
        audioTranscribed: null,
        recipeCreated: null,
        coherenceChecked: null,
    };

    try {
        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
        }
        socialMediaResult = await downloadMediaWithYtDlp(url);
        progress.videoDownloaded = true;

        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
        }
        const transcription = await getTranscription(socialMediaResult.blob);
        progress.audioTranscribed = true;
        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
        }

        // Generate recipe JSON using AI
        const recipe = await generateRecipeFromAI(
            transcription,
            socialMediaResult.description,
            url, // Use the original URL for postURL
            socialMediaResult.thumbnail,
            env.EXTRA_PROMPT || "",
            tags
        );

        console.log("Posting recipe to Mealie", recipe);
        const mealieResponse = await postRecipe(recipe);
        const createdRecipe = await getRecipe(await mealieResponse);
        console.log("Recipe created");
        progress.recipeCreated = true;
        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
        }

        // Step 4: AI coherence check
        let coherenceResult = { pass: true, issue: null as string | null, suggestion: null as string | null };
        try {
            const fullRecipe = await getFullRecipe(await mealieResponse);
            const ingredients = fullRecipe.recipeIngredient.map((i) => i.originalText ?? i.note ?? "").filter(Boolean);
            const instructions = fullRecipe.recipeInstructions.map((s) => s.text).filter(Boolean);
            coherenceResult = await checkRecipeCoherence(fullRecipe.name, ingredients, instructions);
            progress.coherenceChecked = coherenceResult.pass;
        } catch (err) {
            console.error("Coherence check failed:", err);
            progress.coherenceChecked = false;
        }

        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ ...createdRecipe, coherenceResult })}\n\n`)
            );
            controller.close();
            return;
        }
        return new Response(JSON.stringify({ createdRecipe, coherenceResult, progress }), {
            status: 200,
        });
    } catch (error: any) {
        if (isSse && controller) {
            progress.recipeCreated = false;
            controller.enqueue(
                encoder.encode(
                    `data: ${JSON.stringify({
                        error: error.message,
                        progress,
                    })}\n\n`
                )
            );
            controller.close();
            return;
        }
        return new Response(
            JSON.stringify({ error: error.message, progress }),
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    const body: RequestBody = await req.json();
    const url = body.url;
    const tags = body.tags;
    const contentType = req.headers.get("Content-Type");

    if (contentType === "text/event-stream") {
        const stream = new ReadableStream({
            async start(controller) {
                await handleRequest(url, tags, true, controller);
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
    return handleRequest(url, tags, false);
}
