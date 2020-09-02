"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crud_1 = require("@nestjsx/crud");
const util_1 = require("@nestjsx/util");
const mongoose_1 = require("mongoose");
const mongoose = require('mongoose');
mongoose.ObjectId.get((v) => (v ? v.toString() : null));
class MongooseCrudService extends crud_1.CrudService {
    constructor(repo) {
        super();
        this.repo = repo;
        this.entityColumns = [];
        this.entityPrimaryColumns = [];
        this.onInitMapEntityColumns();
        this.onInitMapRelations();
    }
    get findOne() {
        return this.repo.findOne.bind(this.repo);
    }
    get find() {
        return this.repo.find.bind(this.repo);
    }
    get findById() {
        return this.repo.findById.bind(this.repo);
    }
    get count() {
        return this.repo.countDocuments.bind(this.repo);
    }
    get alias() {
        return this.repo.baseModelName;
    }
    async getMany(req) {
        const { parsed, options } = req;
        const { builder, take, skip } = await this.createBuilder(this.find, parsed, options);
        if (this.decidePagination(parsed, options)) {
            const data = await builder;
            const total = await this.count({});
            return this.createPageInfo(data, total, take, skip);
        }
        return builder;
    }
    async getOne(req) {
        return this.getOneOrFail(req);
    }
    async createOne(req, dto) {
        const entity = this.prepareEntityBeforeSave(dto, req.parsed);
        if (!entity) {
            this.throwBadRequestException(`Empty data. Nothing to save.`);
        }
        return this.repo.create(entity);
    }
    async createMany(req, dto) {
        if (!util_1.isObject(dto) || !util_1.isArrayFull(dto.bulk)) {
            this.throwBadRequestException(`Empty data. Nothing to save.`);
        }
        const bulk = dto.bulk
            .map((one) => this.prepareEntityBeforeSave(one, req.parsed))
            .filter((d) => !util_1.isUndefined(d));
        if (!util_1.hasLength(bulk)) {
            this.throwBadRequestException(`Empty data. Nothing to save.`);
        }
        return (await this.repo.create(bulk));
    }
    async updateOne(req, dto) {
        const { allowParamsOverride, returnShallow } = req.options.routes.updateOneBase;
        const paramsFilters = this.getParamFilters(req.parsed);
        const authPersist = req.parsed.authPersist || {};
        const toFind = { ...paramsFilters };
        const found = returnShallow
            ? await this.getOneShallowOrFail(toFind)
            : await this.getOneOrFail(req);
        const toSave = !allowParamsOverride
            ? { ...found.toObject(), ...dto, ...paramsFilters, ...authPersist }
            : { ...found.toObject(), ...dto, ...authPersist };
        const updated = await this.repo.findOneAndUpdate({ _id: found._id }, toSave, {
            new: true,
        });
        if (returnShallow) {
            return updated;
        }
        else {
            req.parsed.paramsFilter.forEach((filter) => {
                filter.value = updated[filter.field];
            });
            return this.getOneOrFail(req);
        }
    }
    async replaceOne(req, dto) {
        const { allowParamsOverride, returnShallow } = req.options.routes.replaceOneBase;
        const paramsFilters = this.getParamFilters(req.parsed);
        const authPersist = req.parsed.authPersist || {};
        const toFind = { ...paramsFilters };
        const found = returnShallow
            ? await this.getOneShallowOrFail(toFind)
            : await this.getOneOrFail(req);
        const toSave = !allowParamsOverride
            ? { ...dto, ...paramsFilters, ...authPersist }
            : { ...paramsFilters, ...dto, ...authPersist };
        const replaced = await this.repo.replaceOne({ _id: found._id }, toSave);
        return this.findById(found._id);
    }
    async deleteOne(req) {
        const { returnDeleted } = req.options.routes.deleteOneBase;
        const paramsFilters = this.getParamFilters(req.parsed);
        const toFind = { ...paramsFilters };
        const found = await this.getOneShallowOrFail(toFind);
        const deleted = await this.repo.findOneAndDelete({ _id: found._id });
        return returnDeleted ? { ...deleted, ...paramsFilters } : undefined;
    }
    getParamFilters(parsed) {
        const filters = {};
        if (util_1.hasLength(parsed.paramsFilter)) {
            for (const filter of parsed.paramsFilter) {
                filters[filter.field] = filter.value;
            }
        }
        return filters;
    }
    decidePagination(parsed, options) {
        return ((Number.isFinite(parsed.page) || Number.isFinite(parsed.offset)) &&
            !!this.getTake(parsed, options.query));
    }
    async createBuilder(fn, parsed, options, many = true) {
        const select = this.getSelect(parsed, options.query);
        const defaultSearch = this.getDefaultSearchCondition(options, parsed);
        const builder = fn(defaultSearch, null, { lean: true });
        builder.select(select);
        const joinOptions = options.query.join || {};
        const allowedJoins = util_1.objKeys(joinOptions);
        if (util_1.hasLength(allowedJoins)) {
            const eagerJoins = {};
            for (let i = 0; i < allowedJoins.length; i++) {
                if (joinOptions[allowedJoins[i]].eager) {
                    const cond = parsed.join.find((j) => j && j.field === allowedJoins[i]) || {
                        field: allowedJoins[i],
                    };
                    this.setJoin(cond, joinOptions, builder);
                    builder.populate(cond.field, cond.select.join(' '));
                    eagerJoins[allowedJoins[i]] = true;
                }
            }
            if (util_1.isArrayFull(parsed.join)) {
                for (let i = 0; i < parsed.join.length; i++) {
                    if (!eagerJoins[parsed.join[i].field]) {
                        this.setJoin(parsed.join[i], joinOptions, builder);
                    }
                }
            }
        }
        if (many) {
            const sort = this.getSort(parsed, options.query);
            builder.sort(sort);
            const take = this.getTake(parsed, options.query);
            if (isFinite(take)) {
                builder.limit(take);
            }
            const skip = this.getSkip(parsed, take);
            if (isFinite(skip)) {
                builder.skip(skip);
            }
            return { builder, take, skip };
        }
        return { builder };
    }
    buildFieldSelect(include, excludes) {
        return (include || [])
            .filter((field) => !(excludes || []).includes(field))
            .concat(...(excludes || []).map((e) => `-${e}`))
            .join(' ');
    }
    buildNestedVirtualPopulate(field, select) {
        const fields = field.split('.');
        const populates = [];
        let lastSchema = this.repo.schema;
        for (let i = 0; i < fields.length; ++i) {
            const virtual = lastSchema.virtualpath(fields[i]);
            if (virtual) {
                lastSchema = mongoose.model(virtual.options.ref).schema;
                populates.push({
                    path: fields[i],
                });
            }
            else {
                this.throwBadRequestException(`${fields[i]} is not a valid join.`);
            }
        }
        return populates.reverse().reduce((populate, cur, index) => ({
            ...cur,
            ...(index === 0 ? { select } : { populate }),
        }), {});
    }
    setJoin(cond, joinOptions, builder) {
        const joinOption = joinOptions[cond.field];
        let excludes = util_1.isNil(joinOption) ? [] : joinOption.exclude;
        if (util_1.isNil(excludes)) {
            excludes = [];
        }
        const select = this.buildFieldSelect(cond.select, excludes);
        const populate = this.buildNestedVirtualPopulate(cond.field, select);
        return builder.populate(populate);
    }
    async getOneOrFail(req) {
        const { parsed, options } = req;
        const { builder } = await this.createBuilder(this.findOne, parsed, options);
        const found = await builder;
        if (!found) {
            this.throwNotFoundException(this.alias);
        }
        return found;
    }
    async getOneShallowOrFail(where) {
        if (where._id) {
            where._id = mongoose_1.Types.ObjectId(where._id);
        }
        const found = await this.findOne(where);
        if (!found) {
            this.throwNotFoundException(this.alias);
        }
        return found;
    }
    prepareEntityBeforeSave(dto, parsed) {
        if (!util_1.isObject(dto)) {
            return undefined;
        }
        if (util_1.hasLength(parsed.paramsFilter)) {
            for (const filter of parsed.paramsFilter) {
                dto[filter.field] = filter.value;
            }
        }
        const authPersist = util_1.isObject(parsed.authPersist) ? parsed.authPersist : {};
        if (!util_1.hasLength(util_1.objKeys(dto))) {
            return undefined;
        }
        return { ...dto, ...authPersist };
    }
    getDefaultSearchCondition(options, parsed) {
        const filter = this.queryFilterToSearch(options.query.filter);
        const paramsFilter = this.queryFilterToSearch(parsed.paramsFilter);
        return { ...filter, ...paramsFilter };
    }
    queryFilterToSearch(filter) {
        return util_1.isArrayFull(filter)
            ? filter.reduce((prev, item) => ({
                ...prev,
                [item.field]: { [item.operator]: item.value },
            }), {})
            : util_1.isObject(filter)
                ? filter
                : {};
    }
    onInitMapEntityColumns() {
        this.repo.schema.eachPath((path) => {
            this.entityColumns.push(path);
        });
    }
    onInitMapRelations() {
    }
    getAllowedColumns(columns, options) {
        return (!options.exclude || !options.exclude.length) &&
            (!options.allow || !options.allow.length)
            ? columns
            : columns.filter((column) => (options.exclude && options.exclude.length
                ? !options.exclude.some((col) => col === column)
                : true) &&
                (options.allow && options.allow.length
                    ? options.allow.some((col) => col === column)
                    : true));
    }
    getSelect(query, options) {
        const allowed = this.getAllowedColumns(this.entityColumns, options);
        const columns = query.fields && query.fields.length
            ? query.fields.filter((field) => allowed.some((col) => field === col))
            : allowed;
        const select = [
            ...(options.persist && options.persist.length ? options.persist : []),
            ...columns,
            ...this.entityPrimaryColumns,
        ]
            .map((col) => `${col}`)
            .join(' ');
        return select;
    }
    getSort(query, options) {
        return query.sort && query.sort.length
            ? this.mapSort(query.sort)
            : options.sort && options.sort.length
                ? this.mapSort(options.sort)
                : {};
    }
    mapSort(sort) {
        const params = {};
        for (let i = 0; i < sort.length; i++) {
            params[sort[i].field] = sort[i].order.toLowerCase();
        }
        return params;
    }
}
exports.MongooseCrudService = MongooseCrudService;
//# sourceMappingURL=mongoose-crud.service.js.map