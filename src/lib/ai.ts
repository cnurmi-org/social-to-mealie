import { env } from "./constants";
import { createOpenAI } from "@ai-sdk/openai";
import { createGroq } from "@ai-sdk/groq";
import { experimental_transcribe, generateObject } from "ai";
import { z } from "zod";
import { pipeline } from '@huggingface/transformers';
import {WaveFile} from 'wavefile';

const client = createOpenAI({
    baseURL: env.OPENAI_URL,
    apiKey: env.OPENAI_API_KEY,
});

const transcriptionModel = client.transcription(env.TRANSCRIPTION_MODEL);

const textModel = env.TEXT_PROVIDER === "minimax"
    ? createOpenAI({ baseURL: "https://api.minimax.io/v1", apiKey: env.MINIMAX_API_KEY }).chat(env.TEXT_MODEL)
    : env.TEXT_PROVIDER === "groq"
    ? createGroq({ apiKey: env.GROQ_API_KEY })(env.TEXT_MODEL)
    : client.chat(env.TEXT_MODEL);

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
            const result = await transcriber(audioData);

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
            schema,
            prompt: `
        You are an expert chef assistant. Extract a complete, accurate recipe from the transcript below and return it as JSON.

        CRITICAL - recipeIngredient field:
        - List EVERY ingredient mentioned anywhere in the transcript or instructions, with quantities and units
        - If an ingredient appears in the instructions but not explicitly listed, still include it
        - Each ingredient must be a plain string like "200g chicken breast" or "1 tbsp olive oil"
        - Do NOT leave this field empty or with only 1 item if the recipe clearly has more ingredients

        CRITICAL - recipeInstructions field:
        - Include ALL steps in the correct order
        - Each step must have a "text" field with the full instruction

        <Metadata>
          Post URL: ${postURL}
          Description: ${description}
          Thumbnail: ${thumbnail}
        </Metadata>

        <Transcription>
          ${transcription}
        </Transcription>

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