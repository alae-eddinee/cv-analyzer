# CV Analyzer

An AI-powered resume analyzer that scores your CV against a job description, identifies weaknesses, and suggests improvements — all in real time.

Built by **Alae-Eddine Dahane**.

## Features

- Upload a CV in PDF, DOCX, or TXT format
- Paste any job description
- Get an instant match score (0–100)
- See specific weaknesses and gaps
- Receive actionable improvement suggestions
- Streams results in real time

## Tech Stack

- **Framework** — Next.js 16 (App Router)
- **Styling** — Tailwind CSS v4 + shadcn/ui
- **Animations** — Framer Motion
- **AI** — OpenRouter API
- **PDF parsing** — pdf-parse
- **DOCX parsing** — mammoth

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/alae-eddinee/cv-analyzer.git
cd cv-analyzer/frontend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API key

Create a `.env.local` file inside the `frontend/` folder:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

Get a free key at [openrouter.ai](https://openrouter.ai).

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

1. Push your repo to GitHub
2. Import it in [Vercel](https://vercel.com)
3. Set **Root Directory** to `frontend`
4. Add `OPENROUTER_API_KEY` in **Environment Variables**
5. Deploy
