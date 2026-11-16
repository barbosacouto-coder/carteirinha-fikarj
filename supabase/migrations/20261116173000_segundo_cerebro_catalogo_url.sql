alter table public.segundo_cerebro_documentos
  drop constraint if exists segundo_cerebro_documentos_tipo_check;

alter table public.segundo_cerebro_documentos
  add constraint segundo_cerebro_documentos_tipo_check
  check (tipo in ('PDF','DOCX','XLSX','HTML','HTM','MD','TXT','JPG','JPEG','PNG','URL'));

