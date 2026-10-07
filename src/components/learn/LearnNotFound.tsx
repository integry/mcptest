import React from 'react';
import { Link } from 'react-router-dom';

const LearnNotFound: React.FC = () => (
  <div className="learn-page learn-not-found" role="alert">
    <h1>Guide not found</h1>
    <p>The Learn guide at this address is unavailable or may have moved.</p>
    <Link className="btn btn-primary" to="/learn">Browse all Learn guides</Link>
  </div>
);

export default LearnNotFound;
