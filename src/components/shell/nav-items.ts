import {
  ArrowLeftRight,
  Bot,
  Briefcase,
  Calculator,
  CircleHelp,
  CreditCard,
  Gem,
  Home,
  Landmark,
  PieChart,
  Tags,
  LineChart,
  PiggyBank,
  Receipt,
  Repeat,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon; mobile?: boolean };

/** Mesma ordem do design aprovado. `mobile` = aparece na barra inferior do celular. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Painel', icon: Home, mobile: true },
  { href: '/transacoes', label: 'Transações', icon: ArrowLeftRight, mobile: true },
  { href: '/previsao', label: 'Previsão', icon: LineChart, mobile: true },
  { href: '/posso-gastar', label: 'Posso gastar?', icon: CircleHelp, mobile: true },
  { href: '/cartoes', label: 'Cartões', icon: CreditCard },
  { href: '/orcamentos', label: 'Orçamentos', icon: Wallet },
  { href: '/categorias', label: 'Categorias e regras', icon: Tags },
  { href: '/analise', label: 'Fixas × variáveis', icon: PieChart },
  { href: '/caixinhas', label: 'Caixinhas e metas', icon: PiggyBank },
  { href: '/patrimonio', label: 'Patrimônio', icon: Gem },
  { href: '/renda', label: 'Renda', icon: Briefcase },
  { href: '/recorrencias', label: 'Recorrências', icon: Repeat },
  { href: '/assinaturas', label: 'Assinaturas', icon: Receipt },
  { href: '/planejados', label: 'Gastos planejados', icon: ShoppingBag },
  { href: '/cenarios', label: 'Cenários', icon: Calculator },
  { href: '/assistente', label: 'Assistente', icon: Bot },
  { href: '/contas', label: 'Contas conectadas', icon: Landmark },
];

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
