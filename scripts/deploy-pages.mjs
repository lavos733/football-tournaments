// Выкладка на GitHub Pages: https://<user>.github.io/<repo>/
// Собирает сайт в подпапку репозитория и отправляет его в ветку gh-pages.
import { execSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'

const repo = process.env.PAGES_REPO ?? 'football-tournaments'
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })

run('npx tsc -b')
run('npx vite build', { BASE_PATH: `/${repo}/` })
// GitHub Pages не умеет «все пути → index.html»; 404.html с тем же содержимым решает это для прямых ссылок
copyFileSync('dist/index.html', 'dist/404.html')
writeFileSync('dist/.nojekyll', '')
run('npx gh-pages -d dist --dotfiles -m "Выкладка сайта"')
