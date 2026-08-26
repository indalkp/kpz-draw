// src/script/script-inbox.js
// Idea Inbox & AI Story Development Layer for KPZ Draw Script Mode.
// Allows capturing raw ideas/notes and using AI (Groq/Ollama) to develop
// them into structured scenes, beats, and characters with review modals.

import { aiComplete } from './script-ai.js';
import { ScriptState } from './script-state.js';
import { toast } from '../ui/toast.js';

export const InboxState = {
  ideas: [],

  init() {
    this.load();
    if (this.ideas.length === 0) {
      this.ideas = [
        {
          id: 'idea_1',
          text: 'An undercover detective discovers a hidden studio where an elusive animator paints future events before they happen.',
          createdAt: Date.now()
        }
      ];
      this.save();
    }
  },

  load() {
    try {
      const raw = localStorage.getItem('kpz_inbox_ideas');
      if (raw) this.ideas = JSON.parse(raw);
    } catch (_) {}
  },

  save() {
    try {
      localStorage.setItem('kpz_inbox_ideas', JSON.stringify(this.ideas));
    } catch (_) {}
  },

  addIdea(text) {
    if (!text || !text.trim()) return null;
    const idea = {
      id: `idea_${Date.now()}`,
      text: text.trim(),
      createdAt: Date.now()
    };
    this.ideas.unshift(idea);
    this.save();
    return idea;
  },

  removeIdea(id) {
    this.ideas = this.ideas.filter(i => i.id !== id);
    this.save();
  }
};

InboxState.init();

/**
 * AI Action: Smart Develop Idea into Beats & Characters
 */
export async function aiDevelopIdea(ideaText) {
  const systemPrompt = `You are an expert film director and screenwriter. Analyze the writer's idea and generate a structured story proposal in valid JSON format.
JSON Schema:
{
  "logline": "1-2 sentence high-concept summary",
  "characters": [
    {"name": "CHARACTER NAME", "role": "Protagonist / Antagonist", "goal": "What they want"}
  ],
  "scenes": [
    {
      "heading": "INT./EXT. LOCATION - DAY/NIGHT",
      "summary": "Visual description of action",
      "dialogue": "Key character dialogue line"
    }
  ]
}`;

  const userPrompt = `Idea: "${ideaText}"\n\nGenerate structured film scenes, beats, and characters.`;

  const rawJson = await aiComplete(userPrompt, {
    system: systemPrompt,
    json: true,
    temperature: 0.7
  });

  try {
    return JSON.parse(rawJson);
  } catch (err) {
    // If strict json parsing fails, extract json block
    const match = rawJson.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI produced unparseable story structure.');
  }
}

/**
 * AI Action: Auto-complete / Continue Screenplay Dialogue
 */
export async function aiContinueDialogue(contextText) {
  const systemPrompt = `You are a professional screenplay dialogue doctor. Continue the scene with 2-3 natural, cinematic lines of dialogue or punchy action. Follow Fountain/Screenplay convention.`;
  return await aiComplete(`Scene so far:\n${contextText}\n\nContinue the scene:`, {
    system: systemPrompt,
    temperature: 0.7
  });
}

/**
 * AI Action: Polish / Tighten Action Lines
 */
export async function aiPolishAction(actionText) {
  const systemPrompt = `You are a Hollywood script reader. Rewrite the following action line into sharp, active, visual screenwriting prose (present tense, vivid imagery, no camera jargon).`;
  return await aiComplete(`Action line:\n${actionText}`, {
    system: systemPrompt,
    temperature: 0.6
  });
}
