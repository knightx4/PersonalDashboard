import { SpeechFixtureProvider } from '@/components/talk/speak-reply';
import { SPEAK_MESSAGES } from '@/lib/talk/speech/speak';
import { SPEAK_HELD_BACK, type SpeechState } from '@/lib/talk/speech/player';
import { AskDashChatsSurface, DashPageSurface } from './ask-surfaces';
import { ChatGroupSurface, ChatThreadSurface } from './chat-surfaces';

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

const PLAYING_T7: SpeechState = { key: 't7', phase: 'playing', notes: {} };
const HELD_BACK_T7: SpeechState = { key: null, phase: 'idle', notes: { t7: SPEAK_HELD_BACK } };

/**
 * A bot speaking (plan #3043): with speaking on, every one of their bubbles
 * has its speaker, the one being read has its bars moving, and the pill at
 * the top of the thread says who is speaking, with Stop. `blocked` is the
 * browser holding the last reply back: its speaker grey with a play arrow.
 */
export function ChatThreadSpeakingSurface({ state }: { state: 'playing' | 'blocked' }) {
  return (
    <SpeechFixtureProvider value={{ speaking: true, state: state === 'playing' ? PLAYING_T7 : HELD_BACK_T7 }}>
      <ChatThreadSurface />
    </SpeechFixtureProvider>
  );
}

const PLAYING_G7: SpeechState = { key: 'g7', phase: 'playing', notes: {} };

/**
 * A group chat with its voice switch on (plan #3082): the switch lit in the
 * header, every bot's bubble with its speaker, and the newest text being
 * read in that bot's voice, named in the pill at the top.
 */
export function ChatGroupSpeakingSurface() {
  return (
    <SpeechFixtureProvider value={{ speaking: true, state: PLAYING_G7 }}>
      <ChatGroupSurface />
    </SpeechFixtureProvider>
  );
}

/** The same in the Ask Dash sheet, with Benjamin Franklin's thread open in it and his last reply being read. */
export function AskDashChatSpeakingSurface({ children }: { children: React.ReactNode }) {
  return (
    <SpeechFixtureProvider value={{ speaking: true, state: PLAYING_T7 }}>
      <AskDashChatsSurface part="chat">{children}</AskDashChatsSurface>
    </SpeechFixtureProvider>
  );
}
