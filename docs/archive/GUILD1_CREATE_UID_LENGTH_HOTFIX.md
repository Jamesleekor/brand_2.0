# Guild 1.1 guild_uid length hotfix

Legacy `public.guilds.guild_uid` is `varchar(20)`.
The previous generator used `GUILD_` + 16 hex chars (=22), causing guild creation to fail.
It now uses `GUILD_` + 14 hex chars (=20).

No existing guild rows are changed.
