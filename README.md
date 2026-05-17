# smart-model-router

> llm-cost-router-for-saas

## О проекте

Учебный проект на typescript. Цель — пройти путь от пустого репо до работающей системы через серию задач, которые наставник ставит в issues.

## Концепции, которые отрабатываются

sd-17-rate-limiting, sd-06-load-balancer, sd-11-api-gateway, sd-12-service-mesh, sd-22-observability, net-21-http-basics.

## Как работать

1. Открой issue с очередной задачей и прочитай критерии приёмки.
2. Создай feature-ветку, реализуй, открой PR в `main`.
3. Дождись ревью наставника - он закрывает PR и ставит следующую задачу.

## Требования

- Node.js >= 20

## Запуск

```bash
npm install              # установка зависимостей
npm run dev              # старт через ts-node на http://localhost:3000
npm run build            # компиляция в dist/
npm start                # запуск собранного приложения из dist/
npm test                 # smoke-тесты на base-эндпоинт
```

Проверить что сервер живой:

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"smart-model-router"}
```

Порт можно переопределить через `PORT=4000 npm run dev`.

## Структура

```
src/
  index.ts          # entry point: env, listen, graceful shutdown
  server.ts         # фабрика HTTP-сервера и роуты
  server.test.ts    # smoke-тесты (node:test)
```

Точка входа отделена от фабрики сервера сознательно: позже это позволит добавлять routing table, rate limiting и observability без переписывания bootstrap-кода.

