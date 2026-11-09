FROM ubuntu:22.04
COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i s,http://,https://,g /etc/apt/sources.list && apt-get -o Acquire::https::Timeout=20 -o Acquire::Retries=1 update && apt-get install -y --no-install-recommends ca-certificates iptables util-linux && rm -rf /var/lib/apt/lists/*
COPY node codex codex-code-mode-host /usr/local/bin/
COPY personal-chat.mjs personal-chat-egress.mjs /app/
COPY public /app/public
COPY entrypoint.sh /usr/local/bin/personal-entry
RUN chmod -R a+rX /app && chmod 755 /usr/local/bin/personal-entry /usr/local/bin/node /usr/local/bin/codex /usr/local/bin/codex-code-mode-host && mkdir -p /workspace /home/personal && chown 1000:1000 /workspace /home/personal
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/personal-entry"]
