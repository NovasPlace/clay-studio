# Clay Studio: the editor and its preview and export server. Python standard library only.
FROM python:3.12-alpine
WORKDIR /app
COPY . .
RUN adduser -D -u 1000 clay && mkdir -p /data && chown clay /data
USER clay
ENV CLAY_HOST=0.0.0.0 CLAY_PORT=8920 CLAY_DATA=/data PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8920
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('CLAY_PORT', '8920'), timeout=2)"
CMD ["python", "serve.py"]
