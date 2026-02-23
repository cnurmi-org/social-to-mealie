import { env } from "./constants";
import { createOpenAI } from "@ai-sdk/openai";
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
    ? createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY }).chat(env.TEXT_MODEL)
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
            }
            return val;
        },
        z.object({
            "@context": z.string().default("https://schema.org"),
            "@type": z.string().default("Recipe"),
            name: z.string(),
            image: z.string().optional(),
            url: z.string().optional(),
            description: z.string(),
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
                    console.info("[ai] raw recipeInstructions:", JSON.stringify(val));
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
            providerOptions: {
                openai: { structuredOutputs: false },
            },
            prompt: `
         You are an expert chef assistant. Review the following recipe transcript and refine it for clarity, conciseness, and accuracy.
        Ensure ingredients and instructions are well-formatted and easy to follow.
        Correct any obvious errors or omissions.
        Output must be valid JSON-LD Schema.org Recipe format.
        The keywords field should not be modified leave it as it comes, it they are not present dont include them.

        <Metadata>
          Post URL: ${postURL}
          Description: ${description}
          Thumbnail: ${thumbnail}
        </Metadata>

        <Transcription>
          ${transcription}
        </Transcription>

        ${
            tags && tags.length > 0 && Array.isArray(tags)
                ? `<keywords>${tags.join(", ")}</keywords>`
                : ""
        }

                ${
                    tags && tags.length > 0 && !Array.isArray(tags)
                        ? `<keywords>${tags}</keywords>`
                        : ""
                }

        Use the thumbnail for the image field and the post URL for the url field.
        Extract ingredients and instructions clearly.
        Output must be valid JSON-LD Schema.org Recipe format.
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