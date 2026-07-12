# browser-asr Setup Guide (New to TypeScript? Start Here)

This is the frontend for Earudite (React + TypeScript, Material UI, Recoil). If this is
your first time working in a TypeScript codebase, read the [TypeScript Crash Course](#typescript-crash-course-for-this-repo)
section below before diving into `src/`.

## Prerequisites

- **Node.js v16.x** — the project uses `react-scripts@4` with an OpenSSL 3 workaround
  (`NODE_OPTIONS=--openssl-legacy-provider`, already wired into the npm scripts), which is
  flaky on Node 18+. Stick to 16 to avoid build errors.
- **npm** (comes with Node) or **yarn** — either works, but don't mix lockfiles.
- A code editor with TypeScript support. **VS Code** is recommended — it understands
  `.ts`/`.tsx` files out of the box and gives you inline type errors as you type.

## Install

```bash
cd browser-asr
npm install
```

## Environment variables

Create/edit `browser-asr/.env` with the backend URLs (ask a team member for values —
these point at the other Earudite services):

```
REACT_APP_PUBLIC_DATAFLOW_URL=
REACT_APP_PUBLIC_SOCKET_URL=
REACT_APP_PUBLIC_SOCKETFLASK_URL=
REACT_APP_PUBLIC_HLS_URL=
```

The backend services (`quizzr-server`, `quizzr-socket-server`, `hls`, `server`) need to
be running too — see the root [README.md](../README.md) for how to start them.

## Run the dev server

```bash
npm start
```

Opens [http://localhost:3000](http://localhost:3000) with hot reload.

## Build for production

```bash
npm run build
```

Output goes to `browser-asr/build/` — the `server` component serves this in production.

## Project layout

```
src/
  App.tsx              # root component
  index.tsx            # entry point
  store.ts             # Recoil atoms/selectors (global state)
  components/          # UI components (mix of .tsx and plain .js/.jsx)
  pkg/                  # local packages
  styles/              # CSS/SCSS
  react-app-env.d.ts   # ambient type declarations for CRA
```

Note: this codebase mixes `.tsx`/`.ts` and plain `.js`/`.jsx` files (`allowJs: true` in
`tsconfig.json`). Don't be surprised to see both — older components haven't all been
migrated to TypeScript yet. New code should be written in `.tsx`/`.ts`.

---

## TypeScript Crash Course (for this repo)

TypeScript is JavaScript with an added **type system** — you write regular JS, plus
optional annotations that describe what shape your data should have. A compiler checks
those annotations *before* your code ever runs, catching a whole class of bugs
("undefined is not a function", passing a string where a number was expected, etc.) at
build/edit time instead of in the browser.

### The parts that matter day-to-day

**File extensions**
- `.ts` — plain TypeScript (logic, no JSX)
- `.tsx` — TypeScript + JSX (React components) — use this for any new component
- `.js`/`.jsx` — still valid here because `allowJs: true` is set; you can import them
  from `.tsx` files freely

**Basic annotations**

```ts
// variables
let count: number = 0;
let name: string = "quiz bowl";
let isActive: boolean = true;

// function params/return types
function addScore(current: number, delta: number): number {
  return current + delta;
}

// object shapes — use `interface` or `type`
interface Player {
  id: string;
  score: number;
  isReady?: boolean; // the `?` marks an optional field
}
```

**React components**

```tsx
type Props = {
  question: string;
  onAnswer: (answer: string) => void;
};

function QuestionCard({ question, onAnswer }: Props) {
  return <div onClick={() => onAnswer("42")}>{question}</div>;
}
```

**Recoil state** (see `src/store.ts`) — atoms are typed via a generic:

```ts
const scoreState = atom<number>({
  key: "scoreState",
  default: 0,
});
```

### This repo's `tsconfig.json` settings, decoded

- `strict: true` — enables the main strictness checks (e.g. no using a possibly-`null`
  value without checking it first).
- `noImplicitAny: false` — the one strictness rule that's turned **off** here. Normally
  `strict` mode forces you to annotate everything; this override means you *can* leave
  something untyped (it becomes implicit `any`, i.e. "trust me, no type checking") without
  the compiler complaining. Prefer adding real types on new code anyway — `any` defeats
  the point of TypeScript and just defers bugs to runtime.
- `allowJs: true` — lets `.js` files live alongside `.ts`/`.tsx` (see note above).
- `jsx: "react-jsx"` — you don't need to `import React` just to use JSX.

### Where to find types for a library

Most libraries ship their own types, or get them from a separate `@types/*` package
(already installed here for `react`, `node`, `jest`, etc. — see `package.json`
`dependencies`). If your editor shows a red squiggle saying "could not find a declaration
file for module X," check whether `@types/X` exists on npm and add it as a dev
dependency.

### Common first-week gotchas

- **Type errors block the build**, but `npm start`'s dev server usually still runs with
  a warning overlay — read it, don't ignore it.
- **`any` is a type**, and it's contagious — anything typed `any` silently disables
  checking wherever it flows. Avoid introducing new `any`s.
- **Optional chaining (`?.`) and nullish coalescing (`??`)** are used throughout to
  handle values that might be `null`/`undefined` — e.g. `user?.profile?.name ?? "Guest"`.
- Material UI (`@material-ui/core` v4 here, not MUI v5) has its own prop types — hover
  a component in your editor to see what props it accepts.

## Getting help

Ping the team in the project channel, or reach out to: Saptarashmi Bandyopadhyay, Shivam
Malhotra, Andrew Chen, Christopher Rapp (see root [README.md](../README.md)).
