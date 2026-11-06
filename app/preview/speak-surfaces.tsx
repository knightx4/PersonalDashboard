import { SpeechFixtureProvider } from '@/components/talk/speak-reply';
import { SPEAK_MESSAGES } from '@/lib/talk/speech/speak';
import type { SpeechState } from '@/lib/talk/speech/player';
import { DashPageSurface } from './ask-surfaces';
import { ChatThreadSurface } from './chat-surfaces';

/**
 * Replies read aloud (plan #3006.1), drawn with the player held in one state
 * so nothing plays: the speaking switch on, and the latest reply either
 * playing (its press reads Stop) or not read, with why under it.
 */

const PLAYING_A2: SpeechState = { key: 'a2', phase: 'playing', notes: {} };
const PAUSED_A2: SpeechState = { key: null, phase: 'idle', notes: { a2: SPEAK_MESSAGES.paused } };
const NOT_SET_T7: SpeechState = { key: null, phase: 'idle', notes: { t7: SPEAK_MESSAGES['not-set'] } };

/** Dash's chat with speaking on: the latest answer playing, or paused for the month. */
export function AskSpeakSurface({ state }: { state: 'playing' | 'paused' }) {
  return (
    <SpeechFixtureProvider value={{ speaking: true, state: state === 'playing' ? PLAYING_A2 : PAUSED_A2 }}>
      <DashPageSurface usedOpen={false} />
    </SpeechFixtureProvider>
  );
}

/** A mentor's thread with speaking on, and their last reply not read because the voice key is not set. */
export function ChatThreadSpeakSurface() {
  return (
    <SpeechFixtureProvider value={{ speaking: true, state: NOT_SET_T7 }}>
      <ChatThreadSurface />
    </SpeechFixtureProvider>
  );
}
