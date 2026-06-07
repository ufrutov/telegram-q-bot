import type { RedisClientType } from "redis";

import BaseQuestionLoader from "./BaseQuestionLoader.js";
import type { Question } from "@/types/question.js";

interface RawQuestionContent {
  question: string | null;
  answer: string | null;
  description: string | null;
  questionPreview: string[];
}

/**
 * ChgkInfoQuestionLoader - Loads questions from questions.chgk.info
 */
export default class ChgkInfoQuestionLoader extends BaseQuestionLoader {
  readonly baseUrl: string;

  constructor() {
    super();
    this.baseUrl =
      "http://questions.chgk.info/cgi-bin/db.cgi?qnum=1&text=0&type=chgk&type=brain&type=igp&type=game&type=ehruditka&type=beskrylka&Get=Get+random+questions&rand=yes";
  }

  /**
   * Decode KOI8-R encoded buffer to string
   */
  private decodeKOI8R(buffer: ArrayBuffer): string {
    const decoder = new TextDecoder("koi8-r");
    return decoder.decode(buffer);
  }

  /**
   * Extract image URLs from HTML content
   */
  private extractImages(content: string): string[] {
    const images: string[] = [];
    const imgRegex = /<p><img src="(.*?)">/g;
    let imgMatch: RegExpExecArray | null;

    while ((imgMatch = imgRegex.exec(content)) !== null) {
      let imgSrc = imgMatch[1] ?? "";
      if (imgSrc.startsWith("/")) {
        imgSrc = "http://questions.chgk.info" + imgSrc;
      }
      images.push(imgSrc);
    }

    return images;
  }

  /**
   * Clean HTML content and remove tags
   */
  private cleanContent(
    content: string,
    options: { removeImages?: boolean; stopAtP?: boolean } = {},
  ): string {
    let cleaned = content;

    if (options.removeImages) {
      cleaned = cleaned.replace(/<p><img[^>]*><\/p>/g, "");
    }

    if (options.stopAtP) {
      const pIndex = cleaned.indexOf("p ");
      if (pIndex !== -1) {
        cleaned = cleaned.substring(0, pIndex);
      }
    }

    cleaned = cleaned
      .replace(/<p\s*\/?>/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&#0150;/g, "-")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();

    return cleaned;
  }

  /**
   * Parse question section from content
   */
  private parseQuestion(content: string, result: RawQuestionContent): void {
    const images = this.extractImages(content);
    result.questionPreview.push(...images);
    result.question = this.cleanContent(content, { removeImages: true });
  }

  /**
   * Parse answer section from content
   */
  private parseAnswer(content: string, result: RawQuestionContent): void {
    const cleaned = this.cleanContent(content, { stopAtP: true });
    result.answer = cleaned.replace(/[<>]/g, "");
  }

  /**
   * Parse description/commentary section from content
   */
  private parseDescription(content: string, result: RawQuestionContent): void {
    const cleaned = this.cleanContent(content, { stopAtP: true });
    result.description = cleaned.replace(/[<>]/g, "");
  }

  /**
   * Process matched strong tags and extract question data
   */
  private processMatches(
    html: string,
    strongMatches: RegExpMatchArray[],
    result: RawQuestionContent,
  ): void {
    strongMatches.forEach((match, i) => {
      const strongText = match[1] ?? "";
      const strongIndex = (match.index ?? 0) + match[0].length;
      const nextIndex = strongMatches[i + 1]?.index ?? html.length;
      const content = html.substring(strongIndex, nextIndex);

      if (strongText.includes("Вопрос 1:")) {
        this.parseQuestion(content, result);
      } else if (strongText.includes("Ответ:")) {
        this.parseAnswer(content, result);
      } else if (strongText.includes("Комментарии:")) {
        this.parseDescription(content, result);
      }
    });
  }

  /**
   * Clean up empty fields from result
   */
  private cleanupResult(result: RawQuestionContent): void {
    if (result.questionPreview.length === 0) {
      result.questionPreview = [];
    }
  }

  /**
   * Load a random question from questions.chgk.info
   */
  override async loadQuestion(
    _questionId?: string | number,
    _redis?: RedisClientType,
  ): Promise<Question> {
    const result: RawQuestionContent = {
      question: null,
      answer: null,
      description: null,
      questionPreview: [],
    };

    try {
      const response = await fetch(this.baseUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const html = this.decodeKOI8R(buffer);

      const strongRegex = /<strong>([\s\S]*?)<\/strong>/g;
      const strongMatches = [...html.matchAll(strongRegex)];

      this.processMatches(html, strongMatches, result);
      this.cleanupResult(result);

      const question: Question = {
        id: 0,
        question: result.question,
        answer: result.answer,
        description: result.description ?? undefined,
        link: "",
        questionPreview: result.questionPreview.length > 0 ? result.questionPreview : undefined,
      };

      return question;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load question: ${message}`);
    }
  }
}
