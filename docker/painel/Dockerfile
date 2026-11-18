# Painel do servidor. Base com o cliente docker, porque todo o controle
# acontece pelo socket montado; python3 so da biblioteca padrao - sem
# dependencia externa para manter.
FROM docker:cli

RUN apk add --no-cache python3 tzdata

WORKDIR /app
COPY app.py instalador.py catalogo.py fluxo.py index.html painel.css painel.js /app/

EXPOSE 8080
CMD ["python3", "-u", "/app/app.py"]
