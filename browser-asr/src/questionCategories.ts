// Single source of truth for the question-recording category picker. Must stay in sync with
// the bucket names in quizzr-server/question_categories.py's ALL_BUCKETS — these are passed
// verbatim as the `category` query param to GET /question/unrec.
export interface QuestionCategoryOption {
    id: string;
    label: string;
}

export const ANY_CATEGORY_ID = "any";

export const QUESTION_CATEGORIES: QuestionCategoryOption[] = [
    { id: ANY_CATEGORY_ID, label: "Any category" },
    { id: "Music ID", label: "Music ID" },
    { id: "Musical Elements", label: "Musical Elements" },
    { id: "Sports/Pop Culture", label: "Sports/Pop Culture" },
    { id: "Character/Person", label: "Character/Person" },
    { id: "Geography", label: "Geography" },
    { id: "Sound/Environment", label: "Sound/Environment" },
    // question_categories.py also defines a "Miscellaneous" fallback bucket, deliberately omitted
    // here: every AUDITA question maps to one of the buckets above, so it would always come back
    // empty. Add it back if an import ever introduces a category with no rule of its own.
];
