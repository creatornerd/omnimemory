import { rawTokens, stem } from './text';
import type { Category } from './types';

/**
 * Keyword-based category suggestion for captured text. It is only a default
 * for the review form — the user always sees and can change it before saving.
 * A future AI-assisted extractor can replace this function.
 */
const KEYWORDS: Record<Exclude<Category, 'Other'>, string[]> = {
  Education: [
    'school', 'class', 'course', 'grade', 'student', 'teacher', 'homework', 'exam', 'study', 'college',
    'university', 'degree', 'gpa', 'semester', 'math', 'physics', 'chemistry', 'biology', 'essay', 'ap',
  ],
  Projects: [
    'project', 'build', 'robot', 'robotics', 'vex', 'team', 'competition', 'startup', 'app', 'prototype',
    'launch', 'deadline', 'client', 'roadmap', 'mvp', 'hackathon',
  ],
  Technology: [
    'code', 'program', 'python', 'javascript', 'typescript', 'react', 'rust', 'java', 'c++', 'linux',
    'mac', 'windows', 'api', 'database', 'git', 'framework', 'library', 'editor', 'laptop', 'software',
    'server', 'docker',
  ],
  Preferences: [
    'prefer', 'like', 'dislike', 'favorite', 'favourite', 'always', 'never', 'style', 'tone', 'format',
    'concise', 'detailed', 'avoid', 'want', 'hate', 'love',
  ],
  Personal: [
    'name', 'live', 'born', 'age', 'family', 'brother', 'sister', 'mother', 'father', 'wife', 'husband',
    'partner', 'dog', 'cat', 'birthday', 'hobby', 'allergic', 'vegetarian', 'vegan', 'city', 'hometown',
  ],
};

const STEMMED: [Exclude<Category, 'Other'>, Set<string>][] = (
  Object.entries(KEYWORDS) as [Exclude<Category, 'Other'>, string[]][]
).map(([category, words]) => [category, new Set(words.map(stem))]);

export function suggestCategory(content: string): Category {
  const tokens = rawTokens(content).map(stem);
  let best: Category = 'Other';
  let bestScore = 0;
  for (const [category, words] of STEMMED) {
    const score = tokens.reduce((count, token) => count + (words.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}
