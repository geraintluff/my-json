var assert = require('chai').assert;
var myJson = require('../../main');

describe('anyOf queries', function () {
	it('separate enum constraint', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			allOf: [
				{
					type: 'object',
					properties: {
						'id': {'enum': [5]}
					}
				},
				{
					type: 'object',
					properties: {
						'name': {'enum': ['test']}
					}
				}
			]
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, [
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` = 5 AND {t}.`name` = \'test\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`name` = \'test\' AND {t}.`id` = 5)'
		]), sql);
	});

	it('collapse AND clauses', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name',
				'string/other': 'other'
			}
		});
		
		var schema = {
			allOf: [
				{
					type: 'object',
					properties: {
						'id': {'enum': [5]}
					}
				},
				{
					type: 'object',
					properties: {
						'name': {'enum': ['test']}
					}
				}
			],
			type: 'object',
			properties: {
				'other': {'enum': ['blah']}
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, [
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` = 5 AND {t}.`name` = \'test\' AND {t}.`other` = \'blah\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`name` = \'test\' AND {t}.`other` = \'blah\' AND {t}.`id` = 5)',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`other` = \'blah\' AND {t}.`id` = 5 AND {t}.`name` = \'test\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` = 5 AND {t}.`other` = \'blah\' AND {t}.`name` = \'test\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`name` = \'test\' AND {t}.`id` = 5 AND {t}.`other` = \'blah\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`other` = \'blah\' AND {t}.`name` = \'test\' AND {t}.`id` = 5)'
		]), sql);
	});

	it('not allOf', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			not: {
				allOf: [
					{
						type: 'object',
						properties: {
							'id': {'enum': [5]}
						}
					},
					{
						type: 'object',
						properties: {
							'name': {'enum': ['test']}
						}
					}
				]
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` != 5 OR {t}.`name` != \'test\')'), sql);
	});
	
	it('collapse OR clauses', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name',
				'string/other': 'other'
			}
		});
		
		var schema = {
			not: {
				allOf: [
					{
						type: 'object',
						properties: {
							'id': {'enum': [5]}
						}
					},
					{
						type: 'object',
						properties: {
							'name': {'enum': ['test']}
						}
					}
				],
				type: 'object',
				properties: {
					'other': {'enum': ['blah']}
				}
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, [
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` != 5 OR {t}.`name` != \'test\' OR {t}.`other` != \'blah\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`name` != \'test\' OR {t}.`other` != \'blah\' OR {t}.`id` != 5)',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`other` != \'blah\' OR {t}.`id` != 5 OR {t}.`name` != \'test\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` != 5 OR {t}.`other` != \'blah\' OR {t}.`name` != \'test\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`name` != \'test\' OR {t}.`id` != 5 OR {t}.`other` != \'blah\')',
			'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`other` != \'blah\' OR {t}.`name` != \'test\' OR {t}.`id` != 5)'
		]), sql);
	});
});
