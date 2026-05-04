# AgendaIA

Monorepo inicial para o sistema de agenda inteligente.

## Estrutura
- `apps/web`: frontend React
- `apps/api`: backend Node.js com TypeScript

## Como rodar localmente
1. Instale as dependências do workspace com `pnpm install`.
2. Inicie o backend com `pnpm --filter @agendaia/api dev`.
3. Inicie o frontend com `pnpm --filter @agendaia/web dev`.

## Scripts de workspace
- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm test`

## Variáveis de ambiente
Copie os arquivos `.env.example` de cada app para configurar o ambiente local.
