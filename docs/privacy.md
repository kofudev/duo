# Data and privacy

Duo saves projects, conversations, usage records and notes in the current user's local application profile. Projects themselves stay in the directories you select. The exact profile path depends on your installation and Windows account.

## What reaches the providers

When you launch a mission, the adapters send the request, selected recent context, project brief, enabled skill instructions and selected memory snippets to the chosen providers. The agents may read project files through their tools. Provider retention and account policies still apply.

The application does not run its own authentication service, collect your password, or ask you to paste an API key. Codex CLI and Claude Code handle their own official login. API and cloud credential environment variables are removed from Duo's subscription-mode subprocesses.

## Memory

Importing a memory file or pasted text is a local operation. No model is called to parse it. The preview lets you edit, exclude and pin notes before storing them. Selected notes are sent to both providers when memory sharing is enabled for a mission.

Web ChatGPT memory is separate from Codex's local memory. The Claude web profile also does not automatically become a Duo profile. Copy the notes you want or choose an exported text file. A conversational export may be incomplete; review it.

Deleting a Duo note removes it from future context selections. It does not erase copies already sent to a provider or included in earlier conversation history.

## Shared tools and SSH

Partner consultations share the current mission board and bounded recent reports with the other selected provider. They are ordinary provider calls within the mission budget. Claude's local MCP bridge uses a short-lived capability token in a private temporary configuration file, which is removed after the CLI exits. The loopback endpoint closes with the call; it rejects unauthenticated and browser-origin requests.

SSH profiles store host or alias, username, port, authorized starting folder, key-file path and explicit permissions. Key contents and passwords are not imported. Host verification and authentication stay with OpenSSH. Remote tool responses can be seen by the acting provider and may be summarized to its partner. The local operation journal keeps metadata and commands, excluding remote file contents and stdout; provider messages and exports can still contain excerpts. Shell permissions use the SSH account's rights and are not confined by the selected starting folder.

## Exports and diagnostics

Conversation exports, memory backups and screenshots can include sensitive information. Review them before attaching them to an issue or sharing them. Never commit your Duo profile, `.env`, tokens, credentials or private prompts to the repository.

## Update checks

The **Mises à jour** button contacts GitHub's public release API only when you click **Vérifier les mises à jour**. It sends a generic application user agent. It does not send your project, memory, conversation or provider credentials. Downloading opens the official installer asset directly in your browser. Duo does not launch it or restart itself.

## Website

The supplied landing site has no analytics, trackers, accounts or application backend. Download links lead to GitHub Releases, and documentation links may lead to GitHub, OpenAI or Anthropic. Those services process their own requests. The hosting provider may retain ordinary access logs.
