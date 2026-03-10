import { env } from "@/lib/constants";
import type { socialMediaResult } from "@/lib/types";
import { YtDlp, type VideoInfo } from "ytdlp-nodejs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

let ytdlp: YtDlp | null = null;

function getYtDlp() {
    if (!ytdlp) {
        ytdlp = new YtDlp({
            ffmpegPath: env.FFMPEG_PATH,
            binaryPath: env.YTDLP_PATH,
        });
    }

    return ytdlp;
}

async function convertBufferToWav(inputBuffer: Uint8Array, fileExt: string = ""): Promise<Buffer> {
    const tempDir = os.tmpdir();
    const ext = fileExt ? (fileExt.startsWith('.') ? fileExt : `.${fileExt}`) : '';
    const inputPath = path.join(tempDir, `input-${Date.now()}${ext}`);
    const outputPath = path.join(tempDir, `output-${Date.now()}.wav`);

    await writeFileAsync(inputPath, inputBuffer);

    try {
        await execAsync(`${env.FFMPEG_PATH} -y -i "${inputPath}" -acodec pcm_s16le -ac 1 -ar 16000 -f wav "${outputPath}"`);
        const buffer = await readFileAsync(outputPath);

        if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF') {
             console.error("Generated WAV file is invalid or too small");
        }
        return buffer;
    } catch (error) {
        console.error("Error converting audio to WAV:", error);
        throw new Error("Failed to convert audio to WAV");
    } finally {
        try { await unlinkAsync(inputPath); } catch {}
        try { await unlinkAsync(outputPath); } catch {}
    }
}

export async function downloadMediaWithYtDlp(
    url: string
): Promise<socialMediaResult> {
    try {
        // Get video metadata first
        const metadata = (await getYtDlp().getInfoAsync(url, {
            cookies: env.COOKIES,
        })) as VideoInfo;

        // Get audio stream as a file/buffer
        const audioFile = await getYtDlp().getFileAsync(url, {
            format: { filter: "audioonly" },
            cookies: env.COOKIES,
        });

        const buffer = await audioFile.bytes();
        const wavBuffer = await convertBufferToWav(buffer, metadata.ext);

        return {
            blob: new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" }),
            thumbnail: metadata.thumbnail,
            description: metadata.description || "No description found",
            title: metadata.title,
        };
    } catch (error) {
        console.error("Error in downloadMediaWithYtDlp:", error);
        throw new Error("Failed to download media or metadata");
    }
}
