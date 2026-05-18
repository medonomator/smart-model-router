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
  server.ts                      # HTTP слой: lookup -> rate-limit -> dispatch
  server.test.ts                 # smoke-тесты + 429-сценарии с виртуальными часами
  routing/
    types.ts                     # типы: HttpMethod, RoutingRule, UpstreamPool, RouteMatch
    upstream-pools.ts            # registry мок upstream pools
    routing-table.ts             # declarative rules + проверка ссылок на пулы
    router.ts                    # lookup(table, method, path) -> RouteMatch | null
    router.test.ts               # тесты на матчинг и отказы
  ratelimit/
    types.ts                     # TokenBucketLimits, RateLimitPolicy, LimiterBackend, ...
    token-bucket.ts              # чистая функция refillAndConsume (без I/O, без clock)
    token-bucket.test.ts         # детерминированные тесты на математику
    policies.ts                  # DEFAULT_RATE_LIMIT_POLICIES + selectPolicy/policyKey
    memory-backend.ts            # InMemoryLimiterBackend (process-local)
    memory-backend.test.ts       # exhaust + refill + изоляция ключей
    redis-backend.ts             # RedisLimiterBackend + atomic Lua script
    redis-backend.test.ts        # FakeRedis-шим, верифицирующий аргументы скрипта
    limiter.ts                   # checkAndConsume(match, backend, policies, now)
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

## Rate limiting

Token bucket поверх каждого матченого маршрута. Pipeline в `server.ts`:

```
request -> lookup(table) -> selectPolicy(match) -> backend.consume(key)
                                                       |
                                                       v
                                          allowed -> dispatch
                                          denied  -> 429 + Retry-After
```

Математика (`refillAndConsume` в `ratelimit/token-bucket.ts`) - чистая функция, без I/O и без `Date.now`. Два бэкенда переиспользуют одну и ту же логику: in-memory повторяет её напрямую, Redis-backend - в виде Lua-скрипта внутри одного `EVAL` (атомарно, чтобы две реплики не разрешили "последний" токен дважды).

Политики лежат в `ratelimit/policies.ts`. Дефолт - per-pool:

- `llm-chat-default`: capacity 60, refill 1 rps (минута burst, потом 1 запрос в секунду)
- `llm-embeddings`: capacity 120, refill 2 rps (embeddings дешевле, лимит мягче)

`selectPolicy` берёт route-scope в приоритет над pool-scope - так горячий path можно прижать сильнее, не переписывая весь пул. Когда ни одна политика не совпадает, запрос пропускается без учёта (rate limiting opt-in).

Ответ при 429:

```
HTTP/1.1 429 Too Many Requests
retry-after: 1
content-type: application/json

{"error":"rate_limited","reason":"token bucket exhausted","policy":"pool:llm-chat-default","retryAfterMs":1000,"capacity":60}
```

Backend выбирается переменной окружения:

```bash
# дефолт - process-local, состояние теряется на рестарте
RATE_LIMIT_BACKEND=memory npm run dev

# распределённый - общий бакет на все реплики
RATE_LIMIT_BACKEND=redis REDIS_URL=redis://localhost:6379 npm run dev
```

`ioredis` ставится только если планируется Redis - в memory-режиме пакет не загружается (`require` отложен внутрь фабрики бэкенда).

Тесты:

- `token-bucket.test.ts` - арифметика на детерминированных часах (exhaust, refill, clock skew, fractional retry)
- `memory-backend.test.ts` - корректная изоляция ключей и refill через "время"
- `redis-backend.test.ts` - FakeRedis-шим повторяет Lua построчно; расходится скрипт и шим - тест падает
- `server.test.ts` - 429 + Retry-After на исчерпанный бакет, восстановление по виртуальным часам

