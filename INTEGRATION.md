# Підключення реальних даних

1. У Google Sheet на аркуші `Оператори` додайте колонки `Slack User ID`, `Роль`, `Керівник LDAP` і, за потреби, `Команда`.
2. Додайте файл `apps-script/SECURE_API_ADDON.gs` у чинний Apps Script проєкт. У Script Properties створіть властивість `KPI_API_SECRET` з довгим випадковим значенням.
3. Створіть новий Apps Script Web app deployment з URL, який закінчується на `/exec`. Він має запускатися від імені власника таблиці; зовнішній доступ захищений спільним секретом.
4. У Script Properties додайте `SLACK_BOT_TOKEN` зі значенням Bot User OAuth Token. Він залишається в Google Apps Script і не передається в чат або браузер.
5. Додайте у секрети хостингу: `KPI_APPS_SCRIPT_URL`, `KPI_APPS_SCRIPT_SECRET` і `KPI_SESSION_SECRET` (щонайменше 32 випадкові символи).
6. Для кожного користувача внесіть його Slack Member ID у `Slack User ID`. Ролі: `operator`, `manager`, `lead`. Для команди менеджера вкажіть LDAP менеджера в `Керівник LDAP`.

Не зберігайте LDAP-паролі. Сайт створює одноразове посилання, відправляє його у Slack DM, а Apps Script зберігає лише хеш токена та позначає його використаним після входу.
