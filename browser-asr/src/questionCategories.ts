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
    { id: "Literature", label: "Literature" },
    { id: "History", label: "History" },
    { id: "Science", label: "Science" },
    { id: "Fine Arts/Music", label: "Fine Arts/Music" },
    { id: "Geography", label: "Geography" },
    { id: "Religion/Mythology/Philosophy", label: "Religion/Mythology/Philosophy" },
    { id: "Sports/Pop Culture", label: "Sports/Pop Culture" },
    { id: "Miscellaneous", label: "Miscellaneous" },
];
