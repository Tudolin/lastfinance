/**
 * Categorias padrão (ponto de partida — o usuário pode criar, renomear e arquivar).
 * O `slug` é estável: é o valor do enum que a IA pode escolher.
 */
export type DefaultCategory = {
  slug: string;
  name: string;
  kind: 'expense' | 'income';
  parent?: string;
  icon?: string;
  color?: string;
};

const P = (slug: string, name: string, icon: string, color: string): DefaultCategory => ({
  slug,
  name,
  kind: 'expense',
  icon,
  color,
});
const C = (parent: string, slug: string, name: string): DefaultCategory => ({
  slug,
  name,
  kind: 'expense',
  parent,
});
const I = (slug: string, name: string): DefaultCategory => ({
  slug,
  name,
  kind: 'income',
  icon: 'banknote',
  color: '#0b6e55',
});

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  P('moradia', 'Moradia', 'home', '#7c5c3b'),
  C('moradia', 'aluguel', 'Aluguel e financiamento'),
  C('moradia', 'condominio', 'Condomínio'),
  C('moradia', 'contas-casa', 'Luz, água e gás'),
  C('moradia', 'internet-telefone', 'Internet e telefone'),
  C('moradia', 'manutencao-casa', 'Manutenção da casa'),
  P('alimentacao', 'Alimentação', 'utensils', '#c2410c'),
  C('alimentacao', 'mercado', 'Mercado'),
  C('alimentacao', 'restaurantes', 'Restaurantes e bares'),
  C('alimentacao', 'delivery', 'Delivery'),
  C('alimentacao', 'padaria-cafe', 'Padaria e café'),
  P('transporte', 'Transporte', 'car', '#1d4ed8'),
  C('transporte', 'combustivel', 'Combustível'),
  C('transporte', 'apps-transporte', 'Apps de transporte'),
  C('transporte', 'transporte-publico', 'Transporte público'),
  C('transporte', 'estacionamento-pedagio', 'Estacionamento e pedágio'),
  C('transporte', 'veiculo', 'Manutenção, IPVA e seguro do veículo'),
  P('saude', 'Saúde', 'heart-pulse', '#be123c'),
  C('saude', 'farmacia', 'Farmácia'),
  C('saude', 'plano-saude', 'Plano de saúde'),
  C('saude', 'consultas-exames', 'Consultas e exames'),
  C('saude', 'academia', 'Academia e esportes'),
  P('educacao', 'Educação', 'graduation-cap', '#6d28d9'),
  C('educacao', 'cursos', 'Cursos e faculdade'),
  C('educacao', 'livros', 'Livros e material'),
  P('lazer', 'Lazer', 'popcorn', '#0e7490'),
  C('lazer', 'assinaturas', 'Streaming e assinaturas'),
  C('lazer', 'viagens', 'Viagens'),
  C('lazer', 'eventos', 'Cinema, shows e eventos'),
  C('lazer', 'jogos', 'Jogos e hobbies'),
  P('compras', 'Compras', 'shopping-bag', '#a16207'),
  C('compras', 'roupas', 'Roupas e acessórios'),
  C('compras', 'eletronicos', 'Eletrônicos'),
  C('compras', 'casa-decoracao', 'Casa e decoração'),
  C('compras', 'presentes', 'Presentes'),
  P('cuidados-pessoais', 'Cuidados pessoais', 'sparkles', '#db2777'),
  P('pets', 'Pets', 'paw-print', '#65a30d'),
  P('financeiro', 'Tarifas, juros e impostos', 'landmark', '#475569'),
  C('financeiro', 'tarifas', 'Tarifas bancárias'),
  C('financeiro', 'juros-iof', 'Juros e IOF'),
  C('financeiro', 'impostos', 'Impostos e taxas'),
  P('doacoes', 'Doações', 'hand-heart', '#0f766e'),
  P('outros', 'Outros', 'circle-ellipsis', '#64748b'),
  I('salario', 'Salário'),
  I('freela', 'Freela / PJ'),
  I('rendimentos', 'Rendimentos'),
  I('reembolsos', 'Reembolsos'),
  I('outras-receitas', 'Outras receitas'),
];
