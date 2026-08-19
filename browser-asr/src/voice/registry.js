import { useEffect, useRef } from "react";

// Screen-local voice commands.
//
// The actions users want by voice (start a game, pick a difficulty, switch models) live in
// component-local useState, and VoiceNav is mounted as a SIBLING of the router — deliberately, so
// its re-renders can't cascade into Game/AnswerBox. That means it cannot reach those handlers
// through props or context.
//
// So screens publish into this module-level registry while they are mounted, and VoiceNav reads it
// at match time. Two consequences worth knowing:
//   - Commands are automatically scoped to their screen: unmount unregisters them, so "reroll"
//     simply doesn't exist unless the transcript picker is on screen. No manual guards needed.
//   - Registration is NOT React state. Publishing a command must never trigger a render, or we
//     reintroduce exactly the render-churn problem VoiceNav's placement exists to avoid.
const providers = new Map();

function setProvider(key, fn) {
  providers.set(key, fn);
}

function clearProvider(key) {
  providers.delete(key);
}

// Providers are called fresh on every match so handlers always close over current state, rather
// than whatever was captured at registration time.
export function getRegisteredIntents() {
  const out = [];
  providers.forEach((fn) => {
    try {
      const intents = fn();
      if (intents && intents.length) out.push.apply(out, intents);
    } catch (e) {
      // A screen mid-unmount shouldn't break voice matching for everything else.
    }
  });
  return out;
}

// Register a screen's commands for as long as the calling component is mounted.
//
// `intents` may be rebuilt every render — it is read through a ref, so handlers stay current
// without re-registering and without the caller needing to memoise anything.
export function useVoiceCommands(key, intents) {
  const ref = useRef(intents);
  ref.current = intents;
  useEffect(() => {
    setProvider(key, () => ref.current);
    return () => clearProvider(key);
  }, [key]);
}
