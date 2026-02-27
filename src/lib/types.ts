export type recipeInfo = {
    postURL: string;
    transcription: string;
    thumbnail: string;
    description: string;
};

export type envTypes = {
    OPENAI_URL: string;
    OPENAI_API_KEY: string;
    TRANSCRIPTION_MODEL: string;
    TEXT_MODEL: string;
    TEXT_PROVIDER: "openai" | "minimax" | "groq";
    MINIMAX_API_KEY: string; // required when TEXT_PROVIDER=minimax
    GROQ_API_KEY: string; // required when TEXT_PROVIDER=groq
    MEALIE_URL: string;
    MEALIE_API_KEY: string;
    MEALIE_GROUP_NAME: string;
    FFMPEG_PATH: string;
    YTDLP_PATH: string;
    EXTRA_PROMPT: string;
    COOKIES: string;
    LOCAL_TRANSCRIPTION_MODEL: string;
};

export type recipeResult = {
    name: string;
    description: string;
    imageUrl: string;
    url: string;
};

export type progressType = {
    videoDownloaded: null | boolean;
    audioTranscribed: null | boolean;
    recipeCreated: null | boolean;
    coherenceChecked: null | boolean;
};

export type coherenceResult = {
    pass: boolean;
    issue: string | null;
    suggestion: string | null;
};

export type socialMediaResult = {
    blob: Blob;
    thumbnail: string;
    description: string;
    title: string;
};

export type tag = {
    id: string;
    groupId: string;
    name: string;
    slug: string;
};

export type Option = {
    label: string;
    value: string;
};

export type MealieRecipeFull = {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    orgURL: string | null;
    image: string | null;
    recipeIngredient: { note?: string; originalText?: string }[];
    recipeInstructions: { text: string; title: string }[];
};

export type CheckItem = {
    pass: boolean;
    fixable: boolean;
};

export type RecipeCheckResult = {
    id: string;
    slug: string;
    name: string;
    mealieUrl: string;
    editUrl: string;
    checks: {
        hasIngredients: CheckItem;
        hasInstructions: CheckItem;
        hasImage: CheckItem;
        hasSourceUrl: CheckItem;
    };
    fixed: string[] | null;
};
