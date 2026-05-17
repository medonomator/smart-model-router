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
  index.ts                       # entry point: env, listen, graceful shutdown
  server.ts                      # тонкий HTTP-слой, делегирует роутеру
  server.test.ts                 # smoke-тесты на HTTP поведение
  routing/
    types.ts                     # типы: HttpMethod, RoutingRule, UpstreamPool, RouteMatch
    upstream-pools.ts            # registry мок upstream pools
    routing-table.ts             # declarative rules + проверка ссылок на пулы
    router.ts                    # lookup(table, method, path) -> RouteMatch | null
    router.test.ts               # тесты на матчинг и отказы
```

Точка входа отделена от фабрики сервера, а фабрика - от policy layer: `server.ts` только парсит метод и URL и делегирует решение `routing/router.ts`. Routing table - это точка расширения для следующих задач (rate limiting, load balancing, observability крепятся к матченому правилу/пулу, а не к HTTP слою).

## Routing table

В `routing/routing-table.ts` лежит declarative набор правил `method + path -> pool name`. Правила ссылаются на upstream pools из `routing/upstream-pools.ts` - каждый пул это `name + endpoints[]`, endpoint несёт `url` и `status` (`available | draining | unavailable`). На старте `buildRoutingTable` валидирует таблицу: дублирующиеся имена пулов и битые ссылки на пулы валят процесс с явной ошибкой, чтобы кривая конфигурация не доезжала до runtime.

`lookup` сейчас матчит по точному совпадению метода и пути (query string отрезается). Pattern-маршруты и path templates - явно следующий шаг, когда понадобится прокидывать параметры.

Проверить новый маршрут:

```bash
curl -i -X POST http://localhost:3000/v1/chat/completions
# 200 {"route":{"method":"POST","path":"/v1/chat/completions"},"pool":{"name":"llm-chat-default"}}

curl -i http://localhost:3000/v1/chat/completions
# 404 {"error":"not_found"}   # метод не описан в таблице для этого path
```

