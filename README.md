# AgendaIA

Monorepo inicial para o sistema de agenda inteligente.

## Estrutura
- `apps/web`: frontend React
- `apps/api`: backend Node.js com TypeScript

## Como rodar localmente
1. Instale as dependências do workspace com `pnpm install`.
2. Inicie o backend com `pnpm --filter @agendaia/api dev`.
3. Inicie o frontend com `pnpm --filter @agendaia/web dev`.

## Banco de dados
- Configure `DATABASE_URL` no arquivo `apps/api/.env`.
- Aplique as migrations com `pnpm --filter @agendaia/api db:migrate`.
- Carregue dados de demonstração com `pnpm --filter @agendaia/api db:seed`.
- Credenciais da seed:
  - `admin@agendaia.local` / `admin123`
  - `profissional@agendaia.local` / `profissional123`

## Postgres Local
1. Crie o banco local `agendaia`.
2. Copie `apps/api/.env.example` para `apps/api/.env`.
3. Ajuste `DATABASE_URL` para apontar para o seu Postgres local.
4. Rode `pnpm --filter @agendaia/api db:migrate`.
5. Rode `pnpm --filter @agendaia/api db:seed`.

Exemplo de `.env` local:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agendaia
SESSION_TTL_DAYS=7
```

## Scripts de workspace
- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm test`

## Variáveis de ambiente
Copie os arquivos `.env.example` de cada app para configurar o ambiente local.
