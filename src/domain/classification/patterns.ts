import { foldText } from '../text/normalize';

/**
 * Padrões textuais por natureza de movimentação. São heurísticas de apoio:
 * a decisão final sempre combina texto + valor + data + contas envolvidas.
 */
/** Padrões fortes: praticamente só aparecem em pagamento de fatura. */
const CARD_PAYMENT_ON_ACCOUNT_STRONG = [
  /\bPAG(?:AMENTO|TO)?\.?\s*(?:DE\s+|DA\s+)?FAT(?:URA)?\b/,
  /\bPAG(?:AMENTO|TO)?\.?\s*(?:DE\s+|DO\s+)?CART(?:AO)?(?:\s+DE\s+CREDITO)?\b/,
  /\bITAU\s*(?:CARTOES|CARD)\b/,
  /\bDEB(?:ITO)?\.?\s+AUT(?:OMATICO)?\.?\s+(?:DE\s+)?(?:FATURA|CARTAO)\b/,
];
/** Padrões fracos: precisam de confirmação por valor/data da fatura (ex.: "FATURA CLARO" é boleto). */
const CARD_PAYMENT_ON_ACCOUNT_WEAK = [/\bFATURA\b/, /\bCARTAO\b/];

const CARD_PAYMENT_ON_CARD = [
  /\bPAGAMENTO\s+(?:RECEBIDO|EFETUADO|DE\s+FATURA|FATURA)\b/,
  /\bPAGTO\b/,
  /\bPAGAMENTO\b/,
  /\bPAYMENT\b/,
  /\bPGTO\b/,
];

const INVESTMENT_IN = [
  /\bAPLIC(?:ACAO|\.)?\b/,
  /\b(?:RDB|CDB|LCI|LCA)\b/,
  /\bCAIXINHA\b/,
  /\bCOFRINHO\b/,
  /\bDINHEIRO\s+GUARDADO\b/,
  /\bGUARDAD[OA]\s+NA\s+CAIXINHA\b/,
  /\bINVEST(?:IMENTO)?\s+(?:FACIL|AUTOMATICO)\b/,
  /\bAPLIC\s+AUT\b/,
];

const INVESTMENT_OUT = [
  /\bRESGATE\b/,
  /\bRESG\.?\b/,
  /\bDINHEIRO\s+RESGATADO\b/,
  /\bRETIRAD[OA]\s+DA\s+CAIXINHA\b/,
  /\bRESGATE\s+(?:RDB|CDB|CAIXINHA)\b/,
];

const TRANSFER = [/\bPIX\b/, /\bTED\b/, /\bDOC\b/, /\bTRANSF(?:ERENCIA)?\b/, /\bTEF\b/];

const REFUND = [/\bESTORNO\b/, /\bDEVOLUCAO\b/, /\bREEMBOLSO\b/, /\bCHARGEBACK\b/, /\bCREDITO\s+DE\s+COMPRA\b/, /\bCANCELAMENTO\b/];

const any = (patterns: RegExp[], s: string) => patterns.some((p) => p.test(s));

/** 2 = padrão forte, 1 = fraco, 0 = nenhum. */
export function cardPaymentTextStrength(d: string): 0 | 1 | 2 {
  const s = foldText(d);
  if (any(CARD_PAYMENT_ON_ACCOUNT_STRONG, s)) return 2;
  if (any(CARD_PAYMENT_ON_ACCOUNT_WEAK, s)) return 1;
  return 0;
}
export const looksLikeCardPaymentOnCard = (d: string) => {
  const s = foldText(d);
  return any(CARD_PAYMENT_ON_CARD, s) && !any(REFUND, s);
};
export const looksLikeInvestmentIn = (d: string) => {
  const s = foldText(d);
  return any(INVESTMENT_IN, s) && !any(INVESTMENT_OUT, s);
};
const INVESTMENT_WORD = /\b(?:RDB|CDB|LCI|LCA|CAIXINHA|COFRINHO|APLIC(?:ACAO)?|INVEST(?:IMENTO)?|AUT(?:OMATICO)?)\b|DINHEIRO RESGATADO|RETIRAD[OA] DA CAIXINHA/;
export const looksLikeInvestmentOut = (d: string) => {
  const s = foldText(d);
  return any(INVESTMENT_OUT, s) && INVESTMENT_WORD.test(s);
};
export const looksLikeTransfer = (d: string) => any(TRANSFER, foldText(d));
export const looksLikeRefund = (d: string) => any(REFUND, foldText(d));
