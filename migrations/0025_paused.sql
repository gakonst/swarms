update swarms set status = 'paused', why = coalesce(why, 'money') where status = 'done';
