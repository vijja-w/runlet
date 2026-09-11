# Runlet

Runlet keeps ordinary files, processing Inboxes, small local Scripts, and reusable AI Prompts together in simple workspaces.

## Install

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/vijja-w/runlet/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/vijja-w/runlet/main/install.ps1 | iex
```

## Use

Start Runlet:

```bash
runlet
```

Then add a workspace folder, connect ChatGPT or Claude from **Connections**, and ask your AI to use Runlet to create or use a Script or Prompt.

See the local workspace tools Runlet provides to connected AI apps:

```bash
runlet tools
```

This is separate from `runlet libraries`, which shows the safe JavaScript APIs available inside a Runlet Script.

Update Runlet:

```bash
runlet update
```

Stop Runlet:

```bash
runlet kill
```

See [Runlet documentation](DOCUMENTATION.md) for everything else.
