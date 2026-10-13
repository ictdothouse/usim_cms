SET password_encryption = 'md5';
ALTER ROLE usim_cms_app WITH PASSWORD :'app_password';
ALTER ROLE usim_cms_provisioner WITH PASSWORD :'provisioner_password';
