import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { parseResultShareUrl } from '../utils/urlUtils';

const DEFAULT_TITLE = 'mcptest.io - MCP Inspector';
const DEFAULT_DESCRIPTION = 'A web-based testing and debugging tool for Model Context Protocol (MCP) servers.';
const BASE_URL = 'https://mcptest.io';
const DEFAULT_IMAGE = `${BASE_URL}/logo.png`;

const setMetaTag = (property: string, content: string) => {
  let element = document.querySelector(`meta[property='${property}']`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('property', property);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
};

export const useMetaTags = () => {
  const location = useLocation();

  useEffect(() => {
    const resultData = parseResultShareUrl(location.pathname, location.search);

    if (resultData) {
      const { type, name, serverUrl } = resultData;
      const title = `MCP Test Result: ${name}`;
      const description = `Result for ${type} '${name}' from MCP server at ${serverUrl}. Click to view the full response.`;
      
      document.title = title;
      setMetaTag('og:title', title);
      setMetaTag('og:description', description);
      setMetaTag('og:url', `${BASE_URL}${location.pathname}${location.search}`);
      setMetaTag('og:image', DEFAULT_IMAGE);
      setMetaTag('og:type', 'article');

    } else {
      document.title = DEFAULT_TITLE;
      setMetaTag('og:title', DEFAULT_TITLE);
      setMetaTag('og:description', DEFAULT_DESCRIPTION);
      setMetaTag('og:url', BASE_URL);
      setMetaTag('og:image', DEFAULT_IMAGE);
      setMetaTag('og:type', 'website');
    }

  }, [location]);
};