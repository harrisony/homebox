package ent

import (
	"database/sql"
	"github.com/nullism/bqb"

	entsql "entgo.io/ent/dialect/sql"
)

// Sql exposes the underlying database connection in the ent client
// so that we can use it to perform custom queries.
func (c *Client) Sql() *sql.DB {
	return c.driver.(*entsql.Driver).DB()
}

func (c *Client) Dialect() string {
	return c.driver.Dialect()
}

func (c *Client) ToSql(q *bqb.Query) (string, []any, error) {
	if c.Dialect() == "postgres" {
		return q.ToPgsql()
	} else {
		return q.ToSql()
	}
}
