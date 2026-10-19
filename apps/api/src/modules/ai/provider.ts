import type { GenType, QuestionDraftInput, QuestionType } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { getAiSettings } from '../platform/settings';

export interface GenInput {
  theme: string;
  level?: string;
  content?: string;
  count: number;
  type: GenType;
  /** Texto extraído de documentos anexados (PDF/DOCX/Excel). */
  attachmentText?: string;
  /** Imagens anexadas, como data URL, enviadas à visão do modelo. */
  images?: { dataUrl: string }[];
}

export interface AiProvider {
  readonly name: 'openai' | 'simulated';
  generate(input: GenInput): Promise<{ questions: QuestionDraftInput[]; model: string | null }>;
}

const CHOICE_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'POLL'];

function systemPrompt(input: GenInput): string {
  const typeInstruction =
    input.type === 'VARIED'
      ? 'Varie os tipos entre única escolha, múltipla escolha e verdadeiro/falso conforme fizer sentido.'
      : `Todas as perguntas devem ser do tipo ${input.type}.`;
  return [
    'Você é um gerador de perguntas de quiz em português do Brasil.',
    'Gere perguntas claras, corretas e adequadas ao público informado.',
    typeInstruction,
    'Regras por tipo:',
    '- SINGLE_CHOICE: 4 alternativas, exatamente 1 correta.',
    '- MULTIPLE_CHOICE: 4 a 6 alternativas, 2 ou mais corretas.',
    '- TRUE_FALSE: exatamente 2 alternativas ("Verdadeiro" e "Falso"), 1 correta.',
    '- POLL: 2 a 6 alternativas, NENHUMA correta (isCorrect sempre false).',
    'Escreva uma breve explicação da resposta correta em cada pergunta (exceto POLL).',
    'Nunca invente fatos; se houver conteúdo/fontes, baseie-se neles.',
  ].join('\n');
}

/** Provedor OpenAI (Chat Completions com JSON estruturado). */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generate(input: GenInput) {
    const images = input.images ?? [];
    const userText = [
      `Tema: ${input.theme}`,
      input.level ? `Nível/público: ${input.level}` : '',
      `Quantidade de perguntas: ${input.count}`,
      input.content ? `Conteúdo/fontes de apoio:\n${input.content}` : '',
      input.attachmentText
        ? `Conteúdo extraído de documentos anexados:\n${input.attachmentText}`
        : '',
      images.length
        ? `Foram anexadas ${images.length} imagem(ns); use-as como base para as perguntas.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    // Mensagem multimodal quando há imagens; caso contrário, texto simples.
    const userContent = images.length
      ? [
          { type: 'text', text: userText },
          ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ]
      : userText;

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.7,
          messages: [
            { role: 'system', content: systemPrompt(input) },
            { role: 'user', content: userContent },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'quiz_questions',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['questions'],
                properties: {
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['type', 'prompt', 'explanation', 'options'],
                      properties: {
                        type: { type: 'string', enum: CHOICE_TYPES },
                        prompt: { type: 'string' },
                        explanation: { type: 'string' },
                        options: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['text', 'isCorrect'],
                            properties: {
                              text: { type: 'string' },
                              isCorrect: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new AppError('AI_FAILED', { reason: (err as Error).message });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError('AI_FAILED', { status: res.status, detail: body.slice(0, 300) });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AppError('AI_FAILED', { reason: 'resposta vazia' });
    let parsed: { questions?: RawQuestion[] };
    try {
      parsed = JSON.parse(content) as { questions?: RawQuestion[] };
    } catch {
      throw new AppError('AI_FAILED', { reason: 'JSON inválido' });
    }
    return { questions: normalize(parsed.questions ?? [], input), model: this.model };
  }
}

/** Provedor simulado para desenvolvimento/testes (sem chave). Gera perguntas determinísticas. */
export class SimulatedAiProvider implements AiProvider {
  readonly name = 'simulated' as const;
  async generate(input: GenInput) {
    const pickType = (i: number): QuestionType =>
      input.type === 'VARIED'
        ? (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'][i % 3] as QuestionType)
        : (input.type as QuestionType);
    const raw: RawQuestion[] = Array.from({ length: input.count }, (_, i) => {
      const type = pickType(i);
      if (type === 'TRUE_FALSE')
        return {
          type,
          prompt: `${input.theme}: afirmação de exemplo ${i + 1}?`,
          explanation: 'Explicação de exemplo (geração simulada).',
          options: [
            { text: 'Verdadeiro', isCorrect: true },
            { text: 'Falso', isCorrect: false },
          ],
        };
      const multi = type === 'MULTIPLE_CHOICE';
      return {
        type,
        prompt: `${input.theme}: pergunta de exemplo ${i + 1}?`,
        explanation: type === 'POLL' ? '' : 'Explicação de exemplo (geração simulada).',
        options: ['A', 'B', 'C', 'D'].map((l, j) => ({
          text: `Alternativa ${l}`,
          isCorrect: type === 'POLL' ? false : multi ? j < 2 : j === 0,
        })),
      };
    });
    return { questions: normalize(raw, input), model: 'simulado' };
  }
}

interface RawQuestion {
  type: string;
  prompt: string;
  explanation?: string;
  options: { text: string; isCorrect?: boolean }[];
}

/** Converte a saída do provedor no formato do editor, saneando limites e coerência. */
function normalize(raw: RawQuestion[], input: GenInput): QuestionDraftInput[] {
  return raw.slice(0, input.count).map((q) => {
    const type = (
      CHOICE_TYPES.includes(q.type as QuestionType) ? q.type : 'SINGLE_CHOICE'
    ) as QuestionType;
    let options = (q.options ?? []).slice(0, 6).map((o) => ({
      text: String(o.text ?? '').slice(0, 120),
      isCorrect: type === 'POLL' ? false : !!o.isCorrect,
    }));
    if (type === 'TRUE_FALSE') {
      options = options.slice(0, 2);
      if (options.length < 2)
        options = [
          { text: 'Verdadeiro', isCorrect: true },
          { text: 'Falso', isCorrect: false },
        ];
    }
    // Garante ao menos uma correta em tipos pontuados.
    if (type !== 'POLL' && !options.some((o) => o.isCorrect) && options[0])
      options[0].isCorrect = true;
    if (type === 'SINGLE_CHOICE') {
      let seen = false;
      options = options.map((o) => {
        const keep = o.isCorrect && !seen;
        if (keep) seen = true;
        return { ...o, isCorrect: keep };
      });
    }
    return {
      type,
      prompt: String(q.prompt ?? '').slice(0, 300),
      durationSeconds: 20,
      basePoints: type === 'POLL' ? 0 : 1000,
      explanation: q.explanation ? String(q.explanation).slice(0, 500) : null,
      options,
    };
  });
}

/** Bloqueado em produção sem chave; usa o simulado em desenvolvimento. */
export async function getAiProvider(ctx: AppContext): Promise<AiProvider> {
  const s = await getAiSettings(ctx);
  if (s.apiKey) return new OpenAiProvider(s.apiKey, s.model);
  if (ctx.env.NODE_ENV === 'production' && process.env.AI_ALLOW_SIMULATED !== '1')
    throw new AppError('AI_NOT_CONFIGURED');
  return new SimulatedAiProvider();
}
