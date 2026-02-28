import { env } from "./constants";
import { createOpenAI } from "@ai-sdk/openai";
import { createGroq } from "@ai-sdk/groq";
import { experimental_transcribe, generateObject } from "ai";
import { z } from "zod";
import type { MealieRecipeFull } from "./types";
import { pipeline } from '@huggingface/transformers';
import {WaveFile} from 'wavefile';

const client = createOpenAI({
    baseURL: env.OPENAI_URL,
    apiKey: env.OPENAI_API_KEY,
});

const transcriptionModel = client.transcription(env.TRANSCRIPTION_MODEL);

// For Groq, use the OpenAI-compatible endpoint instead of @ai-sdk/groq.
// @ai-sdk/groq v2 unconditionally adds response_format: json_schema which
// llama-3.3-70b-versatile (and most Groq models) do not support.
const textModel = env.TEXT_PROVIDER === "minimax"
    ? createOpenAI({ baseURL: "https://api.minimax.io/v1", apiKey: env.MINIMAX_API_KEY }).chat(env.TEXT_MODEL)
    : env.TEXT_PROVIDER === "groq"
    ? createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY }).chat(env.TEXT_MODEL)
    : client.chat(env.TEXT_MODEL);

// Groq models (except a handful) do not support json_schema structured outputs.
// Use json mode for Groq which sends response_format: json_object instead.
// structuredOutputs: false in providerOptions prevents the AI SDK from using json_schema.
const generateObjectMode = env.TEXT_PROVIDER === "groq" ? "json" as const : "auto" as const;
const generateObjectProviderOptions = env.TEXT_PROVIDER === "groq"
    ? { openai: { structuredOutputs: false } }
    : undefined;

export async function getTranscription(blob: Blob): Promise<string> {
    if (env.LOCAL_TRANSCRIPTION_MODEL) {
        console.info("Using local Whisper model for transcription:", env.LOCAL_TRANSCRIPTION_MODEL);
        const transcriber = await pipeline('automatic-speech-recognition', env.LOCAL_TRANSCRIPTION_MODEL);
        const arrayBuffer = Buffer.from(await blob.arrayBuffer());
        try {
            const wav = new WaveFile(new Uint8Array(arrayBuffer));
            wav.toBitDepth('32f');
            wav.toSampleRate(16000);
            let audioData: any = wav.getSamples();
            const result = await transcriber(audioData, {
                chunk_length_s: 30,
                stride_length_s: 5,
            });

            if (result && typeof result === 'object' && 'text' in result) {
                return (result as any).text;
            }

            return String(result);
        } catch (err) {
            console.error('Error transcribing with local Whisper model:', err);
            throw err;
        }
    }

    try {
        const audioBuffer = Buffer.from(await blob.arrayBuffer());

        const result = await experimental_transcribe({
            model: transcriptionModel,
            audio: audioBuffer,
        });

        return result.text;
    } catch (error) {
        console.error("Error in getTranscription (AI SDK):", error);
        throw new Error("Failed to transcribe audio via API");
    }
}

export async function generateRecipeFromAI(
    transcription: string,
    description: string,
    postURL: string,
    thumbnail: string,
    extraPrompt: string,
    tags: string[]
) {
    const schema = z.preprocess(
        (val: any) => {
            if (val && typeof val === "object") {
                // LLMs sometimes use non-schema.org field names
                if (!val.recipeIngredient && val.ingredients) val.recipeIngredient = val.ingredients;
                if (!val.recipeInstructions && (val.instructions ?? val.steps)) val.recipeInstructions = val.instructions ?? val.steps;
                // Normalize nulls to undefined so defaults can kick in
                if (val.name == null) val.name = undefined;
                if (val.description == null) val.description = undefined;
            }
            return val;
        },
        z.object({
            "@context": z.string().default("https://schema.org"),
            "@type": z.string().default("Recipe"),
            name: z.string().default("Unknown Recipe"),
            image: z.string().optional(),
            url: z.string().optional(),
            description: z.string().default(""),
            recipeIngredient: z.preprocess(
                (val: any) => {
                    if (!Array.isArray(val)) return val;
                    return val.map((item: any) => {
                        if (typeof item === "string") return item;
                        if (typeof item === "object" && item !== null) {
                            // Try common field names, fall back to joining all string values
                            return item.text ?? item.name ?? item.ingredient ?? item.item ??
                                Object.values(item).filter((v) => typeof v === "string").join(" ");
                        }
                        return String(item);
                    });
                },
                z.array(z.string())
            ),
            recipeInstructions: z.preprocess(
                (val: any) => {
                    if (!Array.isArray(val)) return val;
                    // Flatten HowToSection -> HowToStep and normalize strings
                    const steps: any[] = [];
                    for (const item of val) {
                        if (typeof item === "string") {
                            steps.push({ "@type": "HowToStep", text: item });
                        } else if (item?.["@type"] === "HowToSection" && Array.isArray(item.itemListElement)) {
                            for (const step of item.itemListElement) {
                                steps.push(typeof step === "string" ? { "@type": "HowToStep", text: step } : step);
                            }
                        } else if (typeof item === "object" && item !== null && !item.text) {
                            // Normalize description/name -> text
                            steps.push({ ...item, text: item.description ?? item.name ?? item.step ?? JSON.stringify(item) });
                        } else {
                            steps.push(item);
                        }
                    }
                    return steps;
                },
                z.array(z.object({
                    "@type": z.string().default("HowToStep"),
                    text: z.string(),
                }))
            ),
            keywords: z.preprocess(
                (val) => typeof val === "string" ? val.split(/[\s,]+/).map((k: string) => k.trim()).filter(Boolean) : val,
                z.array(z.string())
            ).optional(),
        })
    );

    try {
        const { object } = await generateObject({
            model: textModel,
            mode: generateObjectMode,
            providerOptions: generateObjectProviderOptions,
            schema,
            prompt: `
        You are an expert chef assistant. Extract a complete, accurate recipe from the transcript below and return it as JSON.

        Use BOTH the caption and the transcription as sources — they are complementary.
        The caption often contains the recipe name, exact ingredient quantities, and structured steps.
        The transcription contains the spoken walkthrough.

        CRITICAL - name field:
        - Use the recipe name from the caption if present; otherwise infer from the transcription

        CRITICAL - recipeIngredient field:
        - Merge ingredients from BOTH the caption and the transcription
        - Prefer the caption's quantities/units when they conflict with the transcription
        - Each ingredient must be a plain string like "200g chicken breast" or "1 tbsp olive oil"
        - Do NOT leave this field empty or with only 1 item if the recipe clearly has more ingredients

        CRITICAL - recipeInstructions field:
        - Include ALL steps in the correct order
        - Each step must have a "text" field with the full instruction

        <Caption>
          ${description}
        </Caption>

        <Transcription>
          ${transcription}
        </Transcription>

        <Metadata>
          Post URL: ${postURL}
          Thumbnail: ${thumbnail}
        </Metadata>

        ${tags && tags.length > 0 ? `<keywords>${Array.isArray(tags) ? tags.join(", ") : tags}</keywords>` : ""}

        Use the thumbnail for the image field and the post URL for the url field.
        Leave keywords exactly as provided, do not modify them.
        ${
            extraPrompt.length > 1
                ? ` Also the user requests that:
        ${extraPrompt}`
                : ""
        }
      `,
        });

        return object;
    } catch (error) {
        console.error("Error generating recipe with AI:", error);
        throw new Error("Failed to generate recipe structure");
    }
}

export async function checkRecipeCoherence(
    name: string,
    ingredients: string[],
    instructions: string[]
): Promise<{ pass: boolean; issue: string | null; suggestion: string | null }> {
    const schema = z.object({
        pass: z.boolean(),
        issue: z.string().nullable(),
        suggestion: z.string().nullable(),
    });

    try {
        const { object } = await generateObject({
            model: textModel,
            mode: generateObjectMode,
            providerOptions: generateObjectProviderOptions,
            schema,
            prompt: `You are a recipe quality checker. Given the recipe name, ingredient list, and instructions below, determine if they form a coherent, complete dish.

A FAILURE means any of the following:
- The instructions do not match the named dish (e.g. "Chicken Wrap" instructions that never mention assembling a wrap)
- The instructions are clearly incomplete — they describe only part of the process and omit a critical step implied by the dish name or ingredients (e.g. "Cheeseburger Rolls" where instructions only cover making the filling but never mention rolling or assembling)
- A key ingredient present in the ingredient list (e.g. tortillas, pastry, dough) is never used in the instructions

Be strict: a recipe where the instructions trail off before the dish is actually assembled or finished is a failure.

Recipe name: ${name}

Ingredients:
${ingredients.map((i, n) => `${n + 1}. ${i}`).join("\n")}

Instructions:
${instructions.map((s, n) => `${n + 1}. ${s}`).join("\n")}

Return:
- pass: true if the recipe is coherent, false if not
- issue: null if pass, otherwise a short description of the specific mismatch
- suggestion: null if pass, otherwise a brief suggestion for what the instructions should cover`,
        });

        return object;
    } catch (error) {
        console.error("Error checking recipe coherence:", error);
        return { pass: true, issue: null, suggestion: null };
    }
}

export async function generateMissingContent(
    recipe: MealieRecipeFull,
    missing: ("ingredients" | "instructions")[]
): Promise<Partial<MealieRecipeFull>> {
    const ingredientList = recipe.recipeIngredient
        .map((i) => i.originalText ?? i.note ?? "")
        .filter(Boolean);
    const instructionList = recipe.recipeInstructions
        .map((s) => s.text)
        .filter(Boolean);

    const schema = z.object({
        recipeIngredient: z.array(z.string()).optional(),
        recipeInstructions: z.array(z.string()).optional(),
    });

    const needIngredients = missing.includes("ingredients");
    const needInstructions = missing.includes("instructions");

    try {
        const { object } = await generateObject({
            model: textModel,
            mode: generateObjectMode,
            providerOptions: generateObjectProviderOptions,
            schema,
            prompt: `You are an expert chef assistant. A recipe named "${recipe.name}" is incomplete.
${recipe.description ? `Description: ${recipe.description}` : ""}
${!needIngredients && ingredientList.length > 0 ? `Existing ingredients:\n${ingredientList.map((i, n) => `${n + 1}. ${i}`).join("\n")}` : ""}
${!needInstructions && instructionList.length > 0 ? `Existing instructions:\n${instructionList.map((s, n) => `${n + 1}. ${s}`).join("\n")}` : ""}

${needIngredients ? "Generate a complete ingredient list (plain strings with quantities, e.g. '200g chicken breast')." : ""}
${needInstructions ? "Generate complete step-by-step instructions." : ""}

Return only the missing fields.`,
        });

        const patch: Partial<MealieRecipeFull> = {};

        if (needIngredients && object.recipeIngredient) {
            patch.recipeIngredient = object.recipeIngredient.map((note) => ({
                note,
                originalText: note,
                disableAmount: true,
            }));
        }
        if (needInstructions && object.recipeInstructions) {
            patch.recipeInstructions = object.recipeInstructions.map((text) => ({
                text,
                title: "",
            }));
        }

        return patch;
    } catch (error) {
        console.error("Error generating missing content:", error);
        throw new Error("Failed to generate missing recipe content");
    }
}