// helper/totalExposure.js — mssports settlement worker, moved unchanged

import { QueryTypes } from "sequelize";
var TOTAL_EXPOSURE_SQL = `
  SELECT COALESCE(SUM(market_exposure), 0) AS total_exposure
  FROM (
    /* Team markets (match odds / bookmaker \u2026): only the worst runner is at
       risk, so they are grouped per market. */
    SELECT MIN(exposure_amount) AS market_exposure
    FROM user_exposures
    WHERE
      user_id = :user_id
      AND game_type IS NOT NULL
      AND (category IS NOT NULL OR game_type LIKE '%:%')
      AND game_type NOT IN (
        'Normal', 'Ball By Ball', 'Over By Over',
        'khado', 'meter', 'fancy1', 'oddeven', 'fancy2', 'badlo'
      )
      AND game_type NOT LIKE '%Overs Line%'
      AND NOT (
        team_name ILIKE '%back'
        OR team_name ILIKE '%lay'
        OR team_name ILIKE '%totalstake'
      )
    GROUP BY match_id, game_type, event_id

    UNION ALL

    /* Independent rows: fancy-family markets (one row each). */
    SELECT exposure_amount AS market_exposure
    FROM user_exposures
    WHERE
      user_id = :user_id
      AND (
        game_type IS NULL
        OR game_type IN (
          'Normal', 'Ball By Ball', 'Over By Over',
          'khado', 'meter', 'fancy1', 'oddeven', 'fancy2', 'badlo'
        )
        OR game_type LIKE '%Overs Line%'
      )
      AND NOT (
        team_name ILIKE '%back'
        OR team_name ILIKE '%lay'
        OR team_name ILIKE '%totalstake'
      )
  ) subquery;
`;

export { TOTAL_EXPOSURE_SQL };
