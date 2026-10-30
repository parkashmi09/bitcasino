import * as React from 'react';

const CONNECT = { type: 'scoreboard:resize:connect', version: 1 };

/**
 * CricketScoreEmbed: the cricket scoreboard iframe. Its expand / collapse chevron lives inside
 * the embed, so the frame takes the height the embed reports. After a hello
 * ({type:'scoreboard:resize:connect'}) the embed posts {type:'scoreboard:resize', height} on every
 * change, the same handshake TENEXCH's CricketScoreEmbed uses. The embed starts listening only
 * after its app boots, so we keep saying hello every 500ms until it answers (up to 60s). Until
 * then the frame keeps a fixed height that fits the collapsed board.
 *
 * @param {object} props
 * @param {string} props.url   Embed URL from score-url (checked server-side).
 */
export default function CricketScoreEmbed({ url }) {
  const frameRef = React.useRef(null);
  const [height, setHeight] = React.useState(null);
  const origin = React.useMemo(() => new URL(url).origin, [url]);

  React.useEffect(() => {
    let connected = false;
    const onMessage = (e) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === 'scoreboard:resize' && Number.isFinite(e.data.height)) {
        connected = true;
        setHeight(e.data.height);
      }
    };
    window.addEventListener('message', onMessage);
    let tries = 0;
    const hello = setInterval(() => {
      if (connected || ++tries > 120) clearInterval(hello);
      else frameRef.current?.contentWindow?.postMessage(CONNECT, origin);
    }, 500);
    return () => {
      clearInterval(hello);
      window.removeEventListener('message', onMessage);
    };
  }, [origin]);

  return (
    <iframe
      ref={frameRef}
      title="Live score"
      src={url}
      // The embed's own reload drops the connection, so say hello on every load too.
      onLoad={() => frameRef.current?.contentWindow?.postMessage(CONNECT, origin)}
      style={height ? { height } : undefined}
      className="block h-[9rem] w-full border-0 bg-layer2 sm:h-[11rem]"
    />
  );
}
