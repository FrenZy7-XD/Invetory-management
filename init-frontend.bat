set PATH=C:\Program Files\nodejs;%PATH%
cd C:\Users\soham\.gemini\antigravity\scratch\vendor-inventory
call npx create-vite frontend --template react
cd frontend
call npm install
call npm install -D tailwindcss postcss autoprefixer
call npx tailwindcss init -p
