import {
  BARE_PROFILE_RE,
  DATE_RANGE_RE,
  URL_RE,
  isBullet,
  normalizeWhitespace,
  stripBullet,
} from './patterns';
import { parseDateRange } from './dates';
import { dedupe, splitCells, splitList } from './experience';
import type { ResumeSection } from './sections';

export interface ParsedProject {
  name: string;
  role: string;
  description: string;
  highlights: string[];
  technologies: string[];
  url: string;
  repositoryUrl: string;
  startDate: string;
  endDate: string;
  confidence: number;
  note: string;
}

const TECH_LINE_RE =
  /^\s*(?:tech(?:nologies)?|tech\s+stack|stack|built\s+with|tools?|languages?)\s*[:\-–]\s*(.+)$/i;

/**
 * Parses the projects section.
 *
 * Projects are the least standardised part of a resume, so the only structural
 * assumption made here is the safe one: a non-bullet line introduces a project,
 * and the bullets beneath it describe that project.
 */
export function parseProjects(sections: ResumeSection[]): ParsedProject[] {
  const lines = sections
    .filter((section) => section.kind === 'projects')
    .flatMap((section) => section.lines);

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const raw of lines) {
    if (!normalizeWhitespace(raw)) continue;
    if (!isBullet(raw) && current.length > 0) {
      blocks.push(current);
      current = [raw];
    } else {
      current.push(raw);
    }
  }
  if (current.length > 0) blocks.push(current);

  return blocks.map(interpretBlock).filter((project) => project.name.length > 0);
}

function interpretBlock(block: string[]): ParsedProject {
  const project: ParsedProject = {
    name: '',
    role: '',
    description: '',
    highlights: [],
    technologies: [],
    url: '',
    repositoryUrl: '',
    startDate: '',
    endDate: '',
    confidence: 0.5,
    note: '',
  };

  const [headerLine = '', ...rest] = block;
  const header = normalizeWhitespace(headerLine);

  const urls = collectUrls(block.join('\n'));
  project.repositoryUrl = urls.find(isRepository) ?? '';
  project.url = urls.find((url) => url !== project.repositoryUrl) ?? '';

  const range = parseDateRange(header);
  if (range) {
    project.startDate = range.start;
    project.endDate = range.end;
  }

  const cells = splitCells(
    header
      .replace(new RegExp(URL_RE.source, 'gi'), '')
      .replace(new RegExp(BARE_PROFILE_RE.source, 'gi'), '')
      .replace(new RegExp(DATE_RANGE_RE.source, 'gi'), ''),
  )
    .map((cell) => cell.replace(/^[,;|–—\-\s]+|[,;|–—\-\s]+$/g, ''))
    .filter(Boolean);

  project.name = cells[0] ?? '';

  // A second header cell is usually the stack ("React, Node") or a role.
  if (cells[1]) {
    if (/\b(?:lead|owner|author|developer|engineer|designer|contributor|maintainer)\b/i.test(cells[1])) {
      project.role = cells[1];
    } else {
      project.technologies.push(...splitList(cells[1]));
    }
  }

  for (const raw of rest) {
    const text = normalizeWhitespace(stripBullet(raw));
    if (!text) continue;
    const tech = text.match(TECH_LINE_RE);
    if (tech?.[1]) project.technologies.push(...splitList(tech[1]));
    else project.highlights.push(text);
  }

  project.technologies = dedupe(project.technologies).slice(0, 30);
  project.highlights = project.highlights.slice(0, 10);
  project.description = project.highlights.join('\n');

  let confidence = 0.45;
  if (project.name) confidence += 0.25;
  if (project.highlights.length > 0) confidence += 0.1;
  if (project.technologies.length > 0) confidence += 0.08;
  if (project.url || project.repositoryUrl) confidence += 0.07;
  project.confidence = Math.min(0.92, confidence);
  project.note = 'read from the projects section';

  return project;
}

function collectUrls(text: string): string[] {
  // Both patterns are needed: resumes write project links with a scheme
  // ("https://…") about as often as bare ("github.com/user/repo").
  const withScheme = Array.from(text.matchAll(new RegExp(URL_RE.source, 'gi')), (m) => m[0]);
  const bare = Array.from(text.matchAll(new RegExp(BARE_PROFILE_RE.source, 'gi')), (m) => m[0]);
  return [...withScheme, ...bare]
    .map((raw) => {
      const cleaned = raw.replace(/[),.;:'"\]]+$/, '');
      const absolute = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
      try {
        return new URL(absolute).toString().replace(/\/$/, '');
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index);
}

function isRepository(url: string): boolean {
  return /(?:github|gitlab|bitbucket)\.(?:com|org)\/[^/]+\/[^/]+/i.test(url);
}
