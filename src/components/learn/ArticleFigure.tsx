import React, { useEffect, useState } from 'react';
import { getLoadedFigure, loadFigure } from '../../content/figureRegistry';

export interface ArticleFigureProps {
  slug: string;
  name: string;
  alt: string;
  caption?: string;
}

/**
 * An article diagram: the figure's SVG inlined so the `fig-*` classes style
 * it from the theme tokens. Figures load with the article body; one that is
 * not loaded yet is fetched here, and until then (or if it cannot be loaded)
 * the alt text stands in so the article never loses the explanation.
 */
const ArticleFigure: React.FC<ArticleFigureProps> = ({ slug, name, alt, caption }) => {
  const figure = getLoadedFigure(slug, name);
  const [, setLoaded] = useState(false);

  useEffect(() => {
    if (figure) return undefined;
    let active = true;
    loadFigure(slug, name).then(() => active && setLoaded(true), () => undefined);
    return () => {
      active = false;
    };
  }, [figure, slug, name]);

  return (
    <figure className="reading-figure">
      {figure ? (
        <div className="reading-figure-canvas">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={figure.viewBox}
            width={figure.width}
            height={figure.height}
            role="img"
            aria-label={alt}
            dangerouslySetInnerHTML={{ __html: figure.inner }}
          />
        </div>
      ) : (
        <p className="reading-figure-missing">{alt}</p>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
};

export default ArticleFigure;
