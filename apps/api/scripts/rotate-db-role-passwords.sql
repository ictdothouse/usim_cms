SET password_encryption = 'scram-sha-256';
ALTER ROLE usim_cms_app WITH PASSWORD :'app_password';
ALTER ROLE usim_cms_provisioner WITH PASSWORD :'provisioner_password';
ALTER ROLE postgres WITH PASSWORD :'superuser_password';
