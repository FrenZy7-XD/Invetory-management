set PATH=C:\Program Files\nodejs;%PATH%
cd C:\Users\soham\.gemini\antigravity\scratch\vendor-inventory\backend
call npm init -y
call npm install express cors dotenv jsonwebtoken bcryptjs
call npm install -D prisma nodemon @prisma/client
call npx prisma generate
call npx prisma db push
