const REPOSITORY = 'kofudev/duo';
const API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

function versionParts(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error('Version de publication invalide.');
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error('Version invalide.');
  return parts;
}
function isNewer(latest, current) {
  const left = versionParts(latest),
    right = versionParts(current);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
function releaseInfo(release, current) {
  if (!release || release.draft || release.prerelease)
    throw new Error('Publication stable indisponible.');
  const version = versionParts(release.tag_name).join('.');
  const name = `Duo-Setup-${version}.exe`;
  const asset = release.assets?.find((item) => item.name === name);
  const expected = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  if (
    !asset ||
    asset.browser_download_url !== expected ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1000000 ||
    asset.size > 1000000000
  )
    throw new Error('Installateur officiel indisponible.');
  return {
    current,
    version,
    available: isNewer(version, current),
    url: expected,
    bytes: asset.size,
  };
}
async function readJson(response) {
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'Aucune version publique disponible.'
        : 'Vérification indisponible. Réessayer plus tard.'
    );
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 1024 * 1024) throw new Error('Réponse de publication trop volumineuse.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function checkUpdate(current, fetcher = fetch) {
  const response = await fetcher(API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Duo-update-check',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  return releaseInfo(await readJson(response), current);
}
module.exports = { API, checkUpdate, releaseInfo, isNewer };
