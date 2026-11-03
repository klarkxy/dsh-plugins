# Magpie

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Connects DSH to a [magpie](https://usemagpie.ai) gateway running on this computer, your local network, or elsewhere. From the plugin's settings page you point DSH at the gateway, and it fetches the gateway's model list and writes the same provider routes that `magpie dsh` writes — Magpie, Magpie · Responses, and Magpie · Anthropic — plus the default model and web search, so the models show up in the model picker.

## Install

```bash
dsh plugin --profile <name> add @klarkxy/dsh-magpie
```

Replace `<name>` with your profile name and restart the profile.

## Use

- Open **Plugins → Magpie**. Enter the gateway address (the local default is `http://127.0.0.1:3425`), paste the gateway key if the gateway requires one, and choose **Save**, then **Sync now**.
- **Test** checks the connection without changing anything.
- Choose a **default model** for new conversations, and turn on **web search** to run it through the gateway's model.
- **Sync at startup** refreshes the routes once per profile start.
- **Disconnect** removes the magpie routes and reverts the default model and web search; your saved key is kept.

## Limits

- One gateway at a time. The routes are the same ones `magpie dsh` writes, so either tool replaces the other's setup.
- A gateway on another machine needs **Share on local network** turned on in magpie and a gateway key (`magpie gateway-key add <name>`).
- The models shown follow magpie's model list for DSH.
- The default model applies to new conversations; existing sessions keep their model.
- Web search goes through the gateway's model.
- On hosts without a credential store (for example headless), the gateway key is read from the `MAGPIE_GATEWAY_KEY` environment variable.

## License

[SATA License 2.1](LICENSE)
